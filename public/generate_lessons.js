// generate_lessons.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// We are using Node 20's built-in global fetch – no node-fetch needed.

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.VOICE_ID;

if (!ELEVENLABS_API_KEY || !VOICE_ID) {
  console.error('Missing ELEVENLABS_API_KEY or VOICE_ID in .env');
  process.exit(1);
}

// ----- STEP 1: define Month 1 / Chapter 1 / McArthur -----
const lessons = [
  {
    id: 'month1_ch1_mcarthur',
    title: 'Greetings & Introductions',
    character: 'McArthur',
    parts: [
      {
        name: 'story_main',
        text: `
Today we will take your first steps with greetings and introductions.

On your first morning in Waterwheel Village, the sun is low and soft. You walk to the village square. People are busy, but their faces are kind.

At the bakery door, a woman smiles and says, “Hello.” An old man adds, “Good morning.” You answer quietly, “Hello… good morning.” It feels simple, but also important.

You hear other voices around you:
“Hi!”
“Good afternoon!”
“Good evening!”
“Good night.”

A young boy comes to you and says, “My name is Sami.” “Nice to meet you,” you say. He laughs and says, “Nice to meet you too.”

Later, as the day ends, you walk home. You say, “Goodbye” to the shopkeeper and “See you later” to the children playing near the river. These small greetings open many doors in the village.

Now, let us practice together. Please introduce yourself in simple English. You can say or write: “Hello, my name is … I am from …” and maybe add, “Nice to meet you.” I will help you.
        `.trim()
      }
    ]
  }
];

// ----- STEP 2: function to call ElevenLabs and save MP3 -----
async function generateAudio(text, outputFilePath) {
  console.log(`Generating: ${outputFilePath}`);

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

  const body = {
    text,
    model_id: 'eleven_monolingual_v1', // adjust if you use another model
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Error from ElevenLabs:', response.status, errText);
    throw new Error(`Failed to generate audio: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const dir = path.dirname(outputFilePath);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(outputFilePath, buffer);
  console.log(`Saved: ${outputFilePath}`);
}

// ----- STEP 3: loop over lessons / parts -----
async function main() {
  for (const lesson of lessons) {
    for (const part of lesson.parts) {
      const fileName = `${part.name}.mp3`;

      // e.g. /public/audio_lessons/month1_ch1_mcarthur/story_main.mp3
      const outputPath = path.join(
        __dirname,
        'public',
        'audio_lessons',
        lesson.id,
        fileName
      );

      if (fs.existsSync(outputPath)) {
        console.log(`Already exists, skipping: ${outputPath}`);
        continue;
      }

      await generateAudio(part.text, outputPath);
    }
  }

  console.log('All audio generated for Month 1 / Chapter 1!');
}

main().catch(err => {
  console.error('Error in main():', err);
});

