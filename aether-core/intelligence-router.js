"use strict";

/**
 * Sleella / SlieQwenBoss Lo8 integration layer inspired by the Aether-AI
 * conversation architecture.
 *
 * This module intentionally keeps the orchestration layer provider-agnostic.
 * It classifies requests, selects a task lane, and applies safety gates before
 * a provider/agent is allowed to execute an action.
 */

const INTENTS = Object.freeze([
  "query",
  "chat",
  "analysis",
  "code",
  "automation",
  "creative",
  "security",
  "unknown",
]);

const PATTERNS = {
  analysis: [
    /\b(analy[sz]e|assess|evaluate|review|compare|contrast|forecast|predict|metrics|trends)\b/i,
  ],
  code: [
    /\b(write|code|program|script|function|class|debug|fix|refactor|optimize|implement)\b/i,
    /\b(python|javascript|typescript|java|c\+\+|rust|go|node(?:\.js)?)\b/i,
  ],
  automation: [
    /\b(automate|schedule|workflow|batch|pipeline|trigger)\b/i,
  ],
  creative: [
    /\b(write|create|generate|compose|brainstorm)\b.*\b(story|poem|article|essay|blog|idea)\b/i,
  ],
  security: [
    /\b(security|vulnerability|pentest|penetration test|burp suite|burpsuite|nmap|bug bounty|recon)\b/i,
  ],
  query: [
    /\b(what|when|where|who|why|how|which|explain|describe|define|show me|tell me)\b/i,
  ],
};

function classifyIntent(input) {
  const text = String(input || "").trim();
  if (!text) return { intent: "unknown", confidence: 0, scores: {} };

  const scores = Object.fromEntries(INTENTS.map((intent) => [intent, 0]));
  for (const [intent, patterns] of Object.entries(PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) scores[intent] += 1;
    }
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] === 0) {
    return {
      intent: text.split(/\s+/).length < 5 ? "chat" : "query",
      confidence: 0.5,
      scores,
    };
  }

  const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
  return { intent: best[0], confidence: best[1] / total, scores };
}

function taskLaneFor(intent) {
  const lanes = {
    query: "reasoning",
    chat: "conversation",
    analysis: "analysis",
    code: "builder",
    automation: "automation",
    creative: "creation",
    security: "defensive-security",
    unknown: "reasoning",
  };
  return lanes[intent] || lanes.unknown;
}

function safetyGate({ intent, action = "none", authorized = false }) {
  if (intent !== "security") {
    return { allowed: true, requiresConfirmation: false, reason: "normal-task" };
  }

  // Security automation is restricted to explicitly authorized targets.
  if (!authorized) {
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: "security-target-authorization-required",
      action,
    };
  }

  return {
    allowed: true,
    requiresConfirmation: true,
    reason: "authorized-security-task",
    action,
  };
}

function route(input, options = {}) {
  const classification = classifyIntent(input);
  const gate = safetyGate({
    intent: classification.intent,
    action: options.action,
    authorized: Boolean(options.authorized),
  });

  return {
    ...classification,
    lane: taskLaneFor(classification.intent),
    gate,
    modelPool: options.modelPool || "configured-router-pool",
    retryPolicy: Number.isInteger(options.retries) ? options.retries : 8,
  };
}

module.exports = {
  INTENTS,
  classifyIntent,
  taskLaneFor,
  safetyGate,
  route,
};
