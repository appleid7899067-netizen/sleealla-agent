// skills-engine.js - Skill Matching & Management Engine

class SkillsEngine {
  constructor() {
    this.skills = [];
    this.categories = new Set();
    this.initialized = false;
  }

  initSkillsEngine(skillsData) {
    this.skills = skillsData.skills || [];
    this.categories = new Set(this.skills.map(s => s.category));
    this.initialized = true;
    
    return {
      totalSkills: this.skills.length,
      categories: this.categories.size,
      status: 'initialized'
    };
  }

  getAllSkills() {
    return this.skills;
  }

  getCategories() {
    return Array.from(this.categories);
  }

  getSkillsByCategory(category) {
    return this.skills.filter(s => s.category === category);
  }

  searchSkills(query, options = {}) {
    const { topK = 10, categories = null } = options;
    const lowerQuery = query.toLowerCase();
    
    let results = this.skills.filter(skill => {
      const inCategory = !categories || categories.includes(skill.category);
      const matchesQuery = 
        skill.title.toLowerCase().includes(lowerQuery) ||
        skill.description.toLowerCase().includes(lowerQuery) ||
        (skill.keywords && skill.keywords.some(k => k.toLowerCase().includes(lowerQuery)));
      return inCategory && matchesQuery;
    });

    return results.slice(0, topK);
  }

  autoMatch(command) {
    const lowerCommand = command.toLowerCase();
    
    // Find best match using keyword matching
    let bestMatch = null;
    let highestScore = 0;

    for (const skill of this.skills) {
      let score = 0;
      
      // Check title match
      if (lowerCommand.includes(skill.title.toLowerCase())) {
        score += 10;
      }
      
      // Check keywords
      if (skill.keywords) {
        for (const keyword of skill.keywords) {
          if (lowerCommand.includes(keyword.toLowerCase())) {
            score += 5;
          }
        }
      }
      
      // Check description
      if (skill.description.toLowerCase().split(' ').some(word => 
        lowerCommand.includes(word.toLowerCase()) && word.length > 4
      )) {
        score += 2;
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = skill;
      }
    }

    if (bestMatch && highestScore > 0) {
      return {
        skill: bestMatch,
        confidence: Math.min(highestScore / 10, 1.0),
        alternatives: this.skills
          .filter(s => s.id !== bestMatch.id && s.category === bestMatch.category)
          .slice(0, 2),
        message: `พบทักษะ: ${bestMatch.title}`,
        reason: `ตรงกับคำสั่ง ${highestScore} คะแนน`
      };
    }

    return null;
  }

  buildSkillPrompt(activeSkills, defaultPrompt) {
    if (!activeSkills || activeSkills.length === 0) {
      return defaultPrompt;
    }

    const skillDescriptions = activeSkills.map(skill => 
      `- ${skill.title}: ${skill.description}`
    ).join('\n');

    return `${defaultPrompt}

คุณมีทักษะพิเศษต่อไปนี้:
${skillDescriptions}

กรุณาใช้ทักษะเหล่านี้ในการตอบคำถามผู้ใช้`;
  }
}

module.exports = new SkillsEngine();