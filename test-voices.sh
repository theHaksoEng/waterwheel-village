#!/usr/bin/env bash

echo "🔁 Starting voice test loop..."

# Voice map: key=name, value=message
declare -A voices=(
  [mcarthur]="Mr McArthur, what advice do you give to students today?"
  [fatima]="Fatima, what do you recommend for a strong headache today?"
  [ibrahim]="Ibrahim, what are you making in the forge this week?"
  [anika]="Anika, what clothing are you sewing today?"
  [kwame]="Kwame, what do you plan to plant in your field this season?"
  [sophia]="Sophia, what are your students learning today?"
  [liang]="Liang, how is the trade with the nearby town?"
  [johannes]="Johannes, what will you grow in your garden this spring?"
  [aleksanderi]="Aleksanderi, what scripture are you preaching this Sunday?"
  [nadia]="Nadia, how do you design a warm and beautiful house in this climate?"
)

i=0
for character in "${!voices[@]}"; do
  question=${voices[$character]}
  echo "🧪 Testing $character → $question"

  curl -s -X POST https://waterwheel-village.onrender.com/speakbase \
    -H "Content-Type: application/json" \
    -d "{\"text\":\"$question\"}" \
    --output "${character}_test.mp3"

  echo "🔊 Saved voice to ${character}_test.mp3"
  echo "---------------------------------------------"
  sleep 1
  ((i++))
done

echo "✅ Done! All files saved."
