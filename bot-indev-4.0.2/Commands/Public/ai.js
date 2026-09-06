const AIModelRouter = require("../../Modules/AIModelRouter");

module.exports = async ({ Constants: { Colors } }, documents, msg, commandData) => {
	if (!msg.suffix || !msg.suffix.trim()) return msg.sendInvalidUsage(commandData);

	try {
		const result = await AIModelRouter.chat([
			{ role: "system", content: "You are a helpful Discord AI assistant. Answer clearly and concisely." },
			{ role: "user", content: msg.suffix.trim() },
		]);

		const text = result.text || "No response returned.";
		return msg.send({
			embed: {
				color: Colors.RESPONSE,
				title: "AI",
				description: text.slice(0, 3900),
				footer: { text: `Model: ${result.model}` },
			},
		});
	} catch (err) {
		logger.error("AI command failed after model fallback chain.", err);
		return msg.send({
			embed: {
				color: Colors.SOFT_ERR,
				description: `AI request failed: ${err.message}`,
			},
		});
	}
};
