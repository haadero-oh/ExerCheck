import { PoseEngine } from "./pose_engine.js";
import { ReviewHandler } from "./review_handler.js";

// --- DOM ELEMENTS ---
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const videoUpload = document.getElementById("videoUpload");
const analyzeBtn = document.getElementById("analyzeBtn");
const uploadZone = document.getElementById("upload-zone");

// --- STATE ---
let engine = new PoseEngine();
let isAnalyzing = false;
let animationFrameId;
let mediaRecorder;
let recordedChunks = [];
let lastProcessedTime = -1;
let activeStream = null;
let selectedExercise = null;
const SESSION_TYPE = "Video Upload";

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
        onSessionComplete: () => resetSessionState()
    }
);


async function init() {
    await engine.initialize();
    setupExerciseButtons();
    updateFlowControl();
}

function updateFlowControl() {
    const hasExercise = !!selectedExercise;
    const hasFile = !!video.src && video.src.startsWith("blob:");
    const isReviewing = !document.getElementById('review-section').classList.contains('d-none');

    toggleExerciseButtons(isAnalyzing || isReviewing);

    const actualUploadDisabled = isAnalyzing || isReviewing;
    videoUpload.disabled = actualUploadDisabled;

    if (uploadZone) {
        uploadZone.style.opacity = actualUploadDisabled ? "0.5" : "1";
        uploadZone.style.pointerEvents = actualUploadDisabled ? "none" : "auto";
    }

    analyzeBtn.disabled = !hasExercise || !hasFile || isAnalyzing || isReviewing;

}

videoUpload.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) {
        const fileURL = URL.createObjectURL(file);
        video.src = fileURL;
        analyzeBtn.disabled = false;
    }
});

videoUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        analyzeBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Loading...`;
        analyzeBtn.disabled = true;

        lastProcessedTime = -1;
        isAnalyzing = false;
        if (animationFrameId) cancelAnimationFrame(animationFrameId);

        if (video.src.startsWith("blob:")) {
            URL.revokeObjectURL(video.src);
        }

        try {
            engine = new PoseEngine();
            await engine.initialize();

            if (selectedExercise) {
                engine.setExercise(selectedExercise);
            }
        } catch (err) {
            console.error("Failed to re-init engine:", err);
            analyzeBtn.innerHTML = "Engine Error";
            return;
        }

        const fileURL = URL.createObjectURL(file);
        video.src = fileURL;
        video.load();

        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            video.currentTime = 0;

            analyzeBtn.innerHTML = `<i class="bi bi-play-fill"></i> Analyze Video`;
            updateFlowControl();
        };
    }
});
// --- ANALYSIS LOGIC ---
analyzeBtn.addEventListener('click', () => {
    if (!engine.currentExercise || !video.src) return;
    startAnalysis();
});

function startAnalysis() {
    isAnalyzing = true;
    recordedChunks = [];
    lastProcessedTime = -1;
    engine.resetCounter();

    updateFlowControl();
    analyzeBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Analyzing...`;

    activeStream = canvas.captureStream(30);

    const options = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? { mimeType: 'video/webm;codecs=vp9' }
        : { mimeType: 'video/webm' };

    mediaRecorder = new MediaRecorder(activeStream, options);
    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
    };
    mediaRecorder.onstop = () => finishAnalysis();
    mediaRecorder.start();

    video.currentTime = 0;

    video.play().then(() => {
        processVideoFrame();
    }).catch(e => console.error("Play failed", e));
}

function processVideoFrame() {
    if (video.paused || video.ended) {
        if (video.ended && isAnalyzing) {
            isAnalyzing = false;

            console.log("Video ended. capturing buffer...");
            setTimeout(() => {
                if (mediaRecorder && mediaRecorder.state !== "inactive") {
                    mediaRecorder.stop();
                }
            }, 1000);
        }
        return;
    }

    if (video.readyState >= 2 && video.currentTime > lastProcessedTime) {
        try {
            const timestampMs = video.currentTime * 1000;
            engine.processFrame(video, timestampMs, ctx, canvas);
            lastProcessedTime = video.currentTime;
        } catch (error) {
            console.error("Analysis Error:", error);
        }
    }
    animationFrameId = requestAnimationFrame(processVideoFrame);
}

function finishAnalysis() {
    isAnalyzing = false;
    cancelAnimationFrame(animationFrameId);
    if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
        activeStream = null;
    }

    const blob = new Blob(recordedChunks, { type: "video/webm" });
    analyzeBtn.innerHTML = `<i class="bi bi-check-circle"></i> Done`;

    reviewHandler.show(blob, {
        exercise: properExerciseName(engine.currentExercise),
        correct: engine.correctReps,
        incorrect: engine.incorrectReps,
        sessionType: SESSION_TYPE,
        errorBreakdown: engine.detailedErrorCounts,
        avgTime: calculateAverage(engine.repDurations)
    });

    updateFlowControl();
}

// --- UTILS ---
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

function resetSessionState() {
    isAnalyzing = false;
    lastProcessedTime = -1;
    selectedExercise = null;

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    if (engine) {
        engine.resetCounter();
        engine.setExercise(null);
    }

    video.pause();
    if (video.src && video.src.startsWith("blob:")) {
        URL.revokeObjectURL(video.src);
    }

    video.removeAttribute('src');
    video.load();
    videoUpload.value = "";

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    document.querySelectorAll('.exercise-btn').forEach(btn => {
        btn.classList.remove('btn-custom-green');
        btn.classList.add('btn-custom-green-bordered');
        btn.disabled = false;
        btn.style.opacity = "1";
    });

    analyzeBtn.innerHTML = `<i class="bi bi-play-fill"></i> Analyze Video`;
    updateFlowControl();
}

function setupExerciseButtons() {
    document.querySelectorAll('.exercise-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            document.querySelectorAll('.exercise-btn').forEach(b => {
                b.classList.remove('btn-custom-green');
                b.classList.add('btn-custom-green-bordered');
            });
            target.classList.replace('btn-custom-green-bordered', 'btn-custom-green');

            // Update our persistent variable AND the engine
            selectedExercise = target.dataset.exercise;
            if (engine) {
                engine.setExercise(selectedExercise);
            }
            updateFlowControl();
        });
    });
}

function toggleExerciseButtons(disable) {
    document.querySelectorAll('.exercise-btn').forEach(btn => {
        btn.disabled = disable;
        btn.style.opacity = disable ? "0.5" : "1";
    });
}

function calculateAverage(times) {
    if (!times || times.length === 0) return 0;
    const sum = times.reduce((a, b) => a + b, 0);
    return (sum / times.length).toFixed(1);
}

init();