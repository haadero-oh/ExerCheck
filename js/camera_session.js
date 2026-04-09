import { PoseEngine } from "./pose_engine.js";
import { ReviewHandler } from "./review_handler.js"; // Import the new class

// --- DOM ELEMENTS ---
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const countdownOverlay = document.getElementById('countdown-overlay');

// --- STATE ---
const engine = new PoseEngine();
let isRunning = false;
let lastTime = 0;
const TARGET_FPS = 30;
let countdownInterval = null;
let mediaRecorder;
let recordedChunks = [];
const SESSION_TYPE = "Live Recording";

// --- INITIALIZE REVIEW HANDLER ---
const reviewHandler = new ReviewHandler(
    {
        container: document.getElementById('review-section'),
        videoPlayer: document.getElementById('review-video-player'),
        exerciseNameEl: document.getElementById('review-exercise-name'),
        correctCountEl: document.getElementById('review-correctrep-count'),
        incorrectCountEl: document.getElementById('review-incorrectrep-count'),
        finalizeBtn: document.getElementById('finalizeBtn'),
        discardBtn: document.getElementById('discardBtn'),
        uploadStatus: document.getElementById('upload-status')
    },
    {
        // This callback runs when Review is done (Upload OR Discard)
        onSessionComplete: () => resetCameraState()
    }
);

// --- INITIALIZATION ---

async function setup() {
    stopBtn.disabled = true;
    startBtn.disabled = false;
    await engine.initialize();
    engine.onRepTimeout = () => {
        if (isRunning) {
            isRunning = false; 
            stopBtn.click();
            alert("Session stopped: A single repetition exceeded the 15-second limit.");
        }
    };
    toggleExerciseButtons(false);
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } }
    });
    video.srcObject = stream;

    video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        requestAnimationFrame(detectPose);
    };
}

// --- MAIN LOOP ---
function detectPose(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = timestamp - lastTime;

    if (elapsed > 1000 / TARGET_FPS) {
        if (isRunning) {
            engine.processFrame(video, timestamp, ctx, canvas);
        } else {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
        lastTime = timestamp;
    }
    requestAnimationFrame(detectPose);
}

// --- EVENT LISTENERS ---
document.querySelectorAll('.exercise-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.exercise-btn').forEach(b => {
            b.classList.remove('btn-custom-green-bordered');
            b.classList.add('btn-custom-green');
        });
        const target = e.target.closest('button');
        target.classList.remove('btn-custom-green');
        target.classList.add('btn-custom-green-bordered');

        const selected = target.dataset.exercise;
        engine.setExercise(selected);
    });
});


function toggleExerciseButtons(disable) {
    const buttons = document.querySelectorAll('.exercise-btn');
    buttons.forEach(btn => {
        btn.disabled = disable;
        btn.style.opacity = disable ? "0.5" : "1";
        btn.style.cursor = disable ? "not-allowed" : "pointer";
    });
}

startBtn.addEventListener('click', () => {
    if (!engine.currentExercise) {
        alert("Please select an exercise first!");
        return;
    }
    toggleExerciseButtons(true);
    startBtn.setAttribute('disabled', '');
    stopBtn.removeAttribute('disabled');
    startCountdown(8);
});

stopBtn.addEventListener('click', () => {
    isRunning = false;
    toggleExerciseButtons(false);
    stopBtn.setAttribute('disabled', '');
    startBtn.removeAttribute('disabled');
    cleanupTimer();
    stopRecording();
});

// --- COUNTDOWN HELPER ---
function startCountdown(seconds) {
    if (countdownInterval) clearInterval(countdownInterval);
    let timeLeft = seconds;
    countdownOverlay.classList.remove('d-none', 'text-success');
    countdownOverlay.classList.add('text-warning');
    countdownOverlay.innerText = timeLeft;

    countdownInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            isRunning = false;
            countdownOverlay.innerText = timeLeft;
        } else if (timeLeft === 0) {
            countdownOverlay.innerText = "GO!";
            countdownOverlay.classList.replace('text-warning', 'text-success');
        } else {
            cleanupTimer();
            isRunning = true;
            engine.resetCounter();
            startRecording();
        }
    }, 1000);
}

function cleanupTimer() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    countdownOverlay.classList.add('d-none');
}

// --- RECORDING LOGIC ---
function startRecording() {
    recordedChunks = [];
    const stream = canvas.captureStream(30);
    const options = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? { mimeType: 'video/webm;codecs=vp9' }
        : { mimeType: 'video/webm' };

    mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: "video/webm" });

        toggleExerciseButtons(true);
        startBtn.setAttribute('disabled', '');
        stopBtn.setAttribute('disabled', '');
        reviewHandler.show(blob, {
            exercise: properExerciseName(engine.currentExercise),
            correct: engine.correctReps,
            incorrect: engine.incorrectReps,
            sessionType: SESSION_TYPE,
            errorBreakdown: engine.detailedErrorCounts,
            avgTime: calculateAverage(engine.repDurations)
        });
    };

    mediaRecorder.start();
    console.log("Recording started...");
}

function properExerciseName(currentExercise) {
    switch (currentExercise) {
        case "pushups":
            return "Push-ups";
        case "squats":
            return "Bodyweight Squats";
        case "jumpjacks":
            return "Jumping Jacks";
        case "altfwdlunges":
            return "Alternate Forward Lunges";
        case "situps":
            return "Sit-ups";
        case "overheadpress":
            return "Over-head Press";
        default:
            return "Lorem ipsum";
    }
}

function stopRecording() {
    stopBtn.setAttribute('disabled', '');
    startBtn.setAttribute('disabled', '');

    setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }
        isRunning = false;

    }, 1000);
}

function calculateAverage(times) {
    if (!times || times.length === 0) return 0;
    const sum = times.reduce((a, b) => a + b, 0);
    return (sum / times.length).toFixed(1);
}

// --- RESET LOGIC ---
function resetCameraState() {
    recordedChunks = [];
    engine.resetCounter();
    isRunning = false;

    toggleExerciseButtons(false);
    startBtn.disabled = false;
    stopBtn.disabled = true;
}
setup();