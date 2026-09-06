const fetch = require("chainfetch");
const { tokens } = require("../Configurations/auth");

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Priority order: strong general models first, reliable free floor last.
// Override with OPENROUTER_MODELS as a comma-separated environment variable.
const DEFAULT_MODELS = [
	"z-ai/glm-5.3-flash",
	"minimax/minimax-m3:free",
	"nvidia/nemotron-3-ultra:free",
	"openai/gpt-5.6-luna",
];

function getModels() {
	const configured = process.env.OPENROUTER_MODELS;
	if (configured) return configured.split(",").map(model => model.trim()).filter(Boolean);
	return DEFAULT_MODELS;
}

function getApiKey() {
	return process.env.OPENROUTER_API_KEY || (tokens && tokens.openrouterAPI) || "";
}

async function chat(messages, options = {}) {
	const apiKey = getApiKey();
	if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");

	const models = options.models || getModels();
	const body = {
		models,
		messages,
		temperature: options.temperature === undefined ? 0.7 : options.temperature,
		max_tokens: options.maxTokens || 2048,
	};

	const response = await fetch.post(ENDPOINT).set({
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
		"HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://localhost",
		"X-Title": process.env.OPENROUTER_APP_NAME || "GAwesomeBot AI",
	}).send(body).onlyBody();

	if (!response || !response.choices || !response.choices[0]) {
		const reason = response && response.error && (response.error.message || response.error.code);
		throw new Error(reason || "OpenRouter returned no usable response.");
	}

	return {
		text: response.choices[0].message && response.choices[0].message.content || "",
		model: response.model || models[0],
		raw: response,
	};
}

module.exports = { chat, getModels, getApiKey };
