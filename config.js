// config.js

const characterVoices = {
  fatima: process.env.VOICE_FATIMA,
  ibrahim: process.env.VOICE_IBRAHIM,
  anika: process.env.VOICE_ANIKA,
  kwame: process.env.VOICE_KWAME,
  sophia: process.env.VOICE_SOPHIA,
  liang: process.env.VOICE_LIANG,
  johannes: process.env.VOICE_JOHANNES,
  aleksanderi: process.env.VOICE_ALEKSANDERI,
  nadia: process.env.VOICE_NADIA,
  mcarthur: process.env.VOICE_MCARTHUR,
};

const characterAliases = [
  { key: "fatima", names: ["Fatima", "Fati"] },
  { key: "ibrahim", names: ["Ibrahim", "Ibra"] },
  { key: "anika", names: ["Anika", "Ani"] },
  { key: "kwame", names: ["Kwame", "Kwa"] },
  { key: "sophia", names: ["Sophia", "Sophie"] },
  { key: "liang", names: ["Liang", "Li"] },
  { key: "johannes", names: ["Johannes", "Johan"] },
  { key: "aleksanderi", names: ["Aleksanderi", "Aleks"] },
  { key: "nadia", names: ["Nadia", "Nadi"] },
  { key: "mcarthur", names: ["McArthur", "Mr. MacArthur", "Teacher"] },
];

const voiceSettings = {
  default: { stability: 0.5, similarity_boost: 0.5 },
  fatima: { stability: 0.6, similarity_boost: 0.7 },
  ibrahim: { stability: 0.5, similarity_boost: 0.6 },
  anika: { stability: 0.7, similarity_boost: 0.8 },
  kwame: { stability: 0.5, similarity_boost: 0.5 },
  sophia: { stability: 0.6, similarity_boost: 0.7 },
  liang: { stability: 0.5, similarity_boost: 0.6 },
  johannes: { stability: 0.7, similarity_boost: 0.8 },
  aleksanderi: { stability: 0.5, similarity_boost: 0.5 },
  nadia: { stability: 0.6, similarity_boost: 0.7 },
  mcarthur: { stability: 0.5, similarity_boost: 0.6 },
};

module.exports = { characterVoices, characterAliases, voiceSettings };
