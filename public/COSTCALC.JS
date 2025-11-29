function calcLessonCost(teacherMinutes, costPerThousand = 0.18, charsPerMin = 675) {
  const chars = teacherMinutes * charsPerMin;
  const cost = chars * (costPerThousand / 1000);
  return cost.toFixed(2);
}

console.log("50/50:", calcLessonCost(22.5));  
console.log("60/40:", calcLessonCost(27));    
console.log("70/30:", calcLessonCost(31.5));  
