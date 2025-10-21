// app.js (The Browser/Frontend Logic) - Adding Safety Checks

// === 1. Configuration ===
const SERVER_URL = 'http://localhost:3000'; 

// === 2. Global State & DOM Selectors ===
let sessionId = null;
let currentLesson = null;
let studentName = '';
let currentVoiceId = null;

const $ = (id) => document.getElementById(id);

// Get DOM elements based on your HTML structure
// NOTE: We wrap these in a DOMContentLoaded listener (later) for safety
const welcomeForm = $('welcome-form');
const contentsMenu = $('contentsMenu');
const chatContainer = $('chatContainer');
const startChatBtn = $('start-chat-btn');
const userInput = $('userInput');
const sendBtn = $('sendBtn');
const chatHistory = $('chatHistory');
const spinner = $('spinner');
const voiceOutput = $('voiceOutput');
// ... (rest of your declarations)

// ... (rest of helper functions)

// === 5. Event Listeners (Applying Safety Checks) ===
document.addEventListener('DOMContentLoaded', () => {
    // Initial display of the welcome screen
    showScreen('welcome');
    
    // Attempt to focus on name input if it's the first screen
    const nameInput = $('student-name');
    if (nameInput) nameInput.focus();

    // Hide audio player by default
    if (voiceOutput) {
        voiceOutput.style.display = 'none'; 
    }

    // Wrap all listeners in checks to prevent the TypeError
    if (startChatBtn) {
        startChatBtn.addEventListener('click', () => {
            const nameInput = $('student-name');
            studentName = nameInput.value.trim();
            if (studentName) {
                showScreen('contents');
            } else {
                alert("Please enter your name to start.");
                nameInput.focus();
            }
        });
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            const text = userInput.value.trim();
            if (text) {
                sendChatToServer(text);
                userInput.value = ''; 
            }
        });
    }

    if (userInput) {
        userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !userInput.disabled) {
                e.preventDefault(); 
                sendBtn.click();
            }
        });
    }

    // Menu button listeners
    if ($('changeNameBtn')) $('changeNameBtn').addEventListener('click', () => { showScreen('welcome'); });
    if ($('newSessionBtn')) $('newSessionBtn').addEventListener('click', () => { sessionId = null; showScreen('welcome'); });
    if ($('endLessonBtn')) $('endLessonBtn').addEventListener('click', () => { showScreen('contents'); });
    if ($('restartLessonBtn') && currentLesson) $('restartLessonBtn').addEventListener('click', () => { 
        if (currentLesson) window.startLesson(currentLesson.month, currentLesson.chapter); 
    });
    if ($('clearChatBtn')) $('clearChatBtn').addEventListener('click', () => { chatHistory.innerHTML = ''; });
    
    // (Other listeners for download/upload/voice controls should be added here too)
});

// NOTE: The window.startLesson function must remain outside the DOMContentLoaded block
// because it is called directly from the HTML's onclick attribute.


