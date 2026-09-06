// SlieQwenBoss Lo8 — lightweight Skills Engine
// Keeps the 400-skill catalog deterministic and dependency-free for Render/Node.

let skills = [];

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function initSkillsEngine(input) {
  const source = Array.isArray(input) ? input : [];
  skills = source.filter(Boolean).map((skill, index) => ({
    ...skill,
    id: skill.id ?? index + 1
  }));

  const categories = new Set(skills.map(skill => skill.category).filter(Boolean));
  return {
    totalSkills: skills.length,
    categories: categories.size
  };
}

function getAllSkills() {
  return skills;
}

function scoreSkill(command, skill) {
  const query = normalize(command);
  if (!query) return 0;

  const fields = [skill.title, skill.category, skill.benefit, skill.practice]
    .map(normalize)
    .filter(Boolean);

  let score = 0;
  for (const field of fields) {
    if (query.includes(field)) score += 8;

    const words = field.split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3);
    for (const word of words) {
      if (query.includes(word)) score += 1;
    }
  }

  // Generic intent hints improve matching without changing the catalog.
  const hints = {
    code: ['โค้ด', 'code', 'เขียนโปรแกรม', 'โปรแกรม', 'javascript', 'node', 'api'],
    web: ['เว็บ', 'website', 'web', 'ค้นหา', 'browser'],
    ai: ['ai', 'เอไอ', 'โมเดล', 'model', 'llm', 'prompt'],
    data: ['ข้อมูล', 'data', 'ฐานข้อมูล', 'database', 'sql'],
    security: ['ความปลอดภัย', 'security', 'auth', 'token', 'key'],
    project: ['โปรเจกต์', 'project', 'deploy', 'ระบบ', 'งาน']
  };

  for (const [group, terms] of Object.entries(hints)) {
    const queryHas = terms.some(term => query.includes(term));
    const skillHas = fields.some(field => terms.some(term => field.includes(term)));
    if (queryHas && skillHas) score += 4;
  }

  return score;
}

function autoMatch(command) {
  if (!skills.length) return null;

  const ranked = skills
    .map(skill => ({ skill, score: scoreSkill(command, skill) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id - b.skill.id);

  if (!ranked.length) return null;

  const primary = ranked[0];
  const alternatives = ranked
    .slice(1, 4)
    .map(item => item.skill);

  return {
    skill: primary.skill,
    alternatives,
    score: primary.score,
    reason: `จับคู่จากคำสั่งกับหมวด/ชื่อ/ประโยชน์ของ Skill (score ${primary.score})`,
    practice: primary.skill.practice || '',
    message: `พบ Skill ที่เหมาะสม: ${primary.skill.title}`
  };
}

module.exports = {
  initSkillsEngine,
  getAllSkills,
  autoMatch
};
