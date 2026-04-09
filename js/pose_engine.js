import {
    PoseLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8";

export class PoseEngine {
    constructor() {
        this.poseLandmarker = undefined;
        this.currentExercise = null;

        this.correctReps = 0;
        this.incorrectReps = 0;
        this.feedback = [];
        this.currentRepHasError = false;

        this.repStartTime = 0;
        this.lastRepDuration = 0;
        this.repDurations = [];
        this.detailedErrorCounts = {};
        this.onRepTimeout = null;

        this.stage = "up";
        this.runningMode = "VIDEO";

        this.isLoading = true;
        this.errorMessage = null;
        this.isTabActive = true;

        document.addEventListener("visibilitychange", () => {
            this.isTabActive = !document.hidden;
            if (this.isTabActive) {
                console.log("Tab active: Resuming tracking...");
            } else {
                console.log("Tab hidden: Pausing tracking to save resources...");
            }
        });
    }

    async initialize() {
        this.isLoading = true;
        this.errorMessage = null;
        try {
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
            );

            this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
                    delegate: "GPU"
                },
                runningMode: this.runningMode,
                numPoses: 1
            });

            this.isLoading = false;
            console.log("PoseEngine Initialized Successfully");

        } catch (error) {
            this.isLoading = false;
            this.errorMessage = "Network Error: Could not load model.";
            console.error("PoseEngine initialization failed:", error);
        }
    }

    setExercise(exerciseType) {
        this.currentExercise = exerciseType;
        this.resetCounter();
    }

    resetCounter() {
        this.correctReps = 0;
        this.incorrectReps = 0;
        this.stage = "up";
        this.feedback = [];
        this.currentRepHasError = false;
        this.repStartTime = 0;
        this.lastRepDuration = 0;
        this.repDurations = [];
        this.detailedErrorCounts = {};
    }

    processFrame(videoSource, timestamp, ctx, canvas) {
        if (!this.isTabActive) return;
        if (!this.poseLandmarker) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "black";
            ctx.font = "bold 30px Arial";
            ctx.textAlign = "center";

            if (this.isLoading) {
                ctx.fillText("Loading model.", canvas.width / 2, canvas.height / 2);
            } else if (this.errorMessage) {
                ctx.fillStyle = "red";
                ctx.fillText(this.errorMessage, canvas.width / 2, canvas.height / 2);
                ctx.font = "20px Arial";
                ctx.fillText("Check your internet connection.", canvas.width / 2, (canvas.height / 2) + 40);
            }
            return;
        }
        if (videoSource.videoWidth === 0 || videoSource.videoHeight === 0) return;

        try {
            const results = this.poseLandmarker.detectForVideo(videoSource, timestamp);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(videoSource, 0, 0, canvas.width, canvas.height);

            if (results.landmarks && results.landmarks.length > 0) {
                const lm = results.landmarks[0];

                this.drawSkeleton(ctx, lm, canvas.width, canvas.height);
                this.drawAngleValues(ctx, lm, canvas.width, canvas.height);

                if (this.currentExercise) {
                    this.analyzeExercise(lm, ctx);
                    if (this.stage === "down" && this.repStartTime > 0) {
                        const elapsed = (Date.now() - this.repStartTime) / 1000;
                        if (elapsed >= 15) {
                            console.warn("Repetition exceeded 15 seconds. Stopping...");
                            if (this.onRepTimeout) this.onRepTimeout();
                            return;
                        }
                    }
                }
                this.drawCounter(ctx);
            }
        } catch (e) {
            console.warn("Frame processing error (likely temporary):", e);
        }
    }

    analyzeExercise(lm, ctx) {
        const checkStartTimer = () => {
            if (this.stage === "up") {
                this.repStartTime = Date.now();
            }
        };
        const sideFacingExercises = ['pushups', 'squats', 'altfwdlunges', 'situps'];
        if (sideFacingExercises.includes(this.currentExercise)) {
            if (!this.isFacingSideways(lm)) {
                this.drawFeedback(ctx, ["Please face sideways to the camera."]);
                return; 
            }
        }

        if (this.currentExercise === 'pushups') {
            const midShoulder = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
            const midAnkle = { x: (lm[27].x + lm[28].x) / 2, y: (lm[27].y + lm[28].y) / 2 };

            if (!this.checkHorizontal(midShoulder, midAnkle)) {
                this.drawFeedback(ctx, ["Please assume horizontal position."]);
                return;
            }

            const avgElbow = (this.calculateAngle(lm[11], lm[13], lm[15]) + this.calculateAngle(lm[12], lm[14], lm[16])) / 2;
            const avgBody = (this.calculateAngle(lm[11], lm[23], lm[27]) + this.calculateAngle(lm[12], lm[24], lm[28])) / 2;

            if (avgBody < 160) {
                this.addPersistentFeedback("Push-up: Body is not aligned.");
                this.currentRepHasError = true;
                this.drawBodyLine(ctx, lm[11], lm[23], lm[27], "red");
            } else if (!this.currentRepHasError) {
                this.drawBodyLine(ctx, lm[11], lm[23], lm[27], "#00ff00");
            }

            if (avgElbow < 90) {
                checkStartTimer();
                this.stage = "down";
                if (avgElbow < 30) {
                    this.addPersistentFeedback("Push-up: Arms are bent too narrowly.");
                    this.currentRepHasError = true;
                }
            }

            if (avgElbow > 160 && this.stage === "down") {
                this.completeRepetition();
            }
        }
        else if (this.currentExercise === 'squats') {
            const kneeAngle = (this.calculateAngle(lm[23], lm[25], lm[27]) + this.calculateAngle(lm[24], lm[26], lm[28])) / 2;
            const backAngle = this.calculateAngle({ x: lm[23].x, y: lm[23].y - 0.1 }, lm[23], lm[11]);

            if (kneeAngle < 45) {
                this.addPersistentFeedback("Squats: Squatting too deep.");
                this.currentRepHasError = true;
            }
            if (backAngle > 60) {
                this.addPersistentFeedback("Squats: Leaning too forward.");
                this.currentRepHasError = true;
            }

            if (kneeAngle < 100) {
                checkStartTimer();
                this.stage = "down";
            }
            if (kneeAngle > 160 && this.stage === "down") {
                this.completeRepetition();
            }
        }
        else if (this.currentExercise === 'altfwdlunges') {
            const leftKneeAngle = this.calculateAngle(lm[23], lm[25], lm[27]);
            const rightKneeAngle = this.calculateAngle(lm[24], lm[26], lm[28]);
            const activeKneeAngle = Math.min(leftKneeAngle, rightKneeAngle);

            const midHip = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
            const midShoulder = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
            const verticalPoint = { x: midHip.x, y: midHip.y - 0.5 };
            const torsoAngle = this.calculateAngle(verticalPoint, midHip, midShoulder);

            if (torsoAngle > 30) {
                this.addPersistentFeedback("Alt. forward lunges: Leaning too forward.");
                this.currentRepHasError = true;
                this.drawBodyLine(ctx, midShoulder, midHip, midHip, "red");
            }

            if (activeKneeAngle < 100) {
                checkStartTimer();
                this.stage = "down";
            }
            if (activeKneeAngle > 160 && this.stage === "down") {
                this.completeRepetition();
            }
        }
        else if (this.currentExercise === 'situps') {
            const midShoulder = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
            const midHip = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
            const midAnkle = { x: (lm[27].x + lm[28].x) / 2, y: (lm[27].y + lm[28].y) / 2 };
            const verticalPoint = { x: midHip.x, y: midHip.y - 0.5 };
            const torsoAngle = this.calculateAngle(verticalPoint, midHip, midShoulder);

            if (!this.checkHorizontal(midHip, midAnkle)) {
                this.drawFeedback(ctx, ["Please lie down for situps."]);
                return;
            }

            if (midAnkle.y < (midHip.y - (midHip.y * 0.05))) {
                this.addPersistentFeedback("Sit-ups: Keep your feet flat.");
                this.currentRepHasError = true;
                this.drawBodyLine(ctx, midHip, midAnkle, midAnkle, "red");
            }

            if (torsoAngle < 30) {
                checkStartTimer();
                this.stage = "down";
            }
            if (this.stage === "down" && torsoAngle > 75) {
                this.completeRepetition();
            }
        }
        else if (this.currentExercise === 'jumpjacks') {
            const nose = lm[0], leftWrist = lm[15], rightWrist = lm[16];
            const leftAnkle = lm[27], rightAnkle = lm[28];
            const ankleDist = Math.abs(leftAnkle.x - rightAnkle.x);
            const shoulderDist = Math.abs(lm[11].x - lm[12].x);

            const targetDist = shoulderDist * 1.4;
            const legsSpread = ankleDist > targetDist;

            // Hands above nose (Top of the jack)
            if (leftWrist.y < nose.y && rightWrist.y < nose.y) {
                const indicatorColor = legsSpread ? "#00ff00" : "red";

                if (!legsSpread) {
                    this.addPersistentFeedback("Jumping jacks: Spread your legs wider.");
                    this.currentRepHasError = true;
                } else {
                    checkStartTimer();
                    this.stage = "down";
                }

                ctx.beginPath();
                ctx.strokeStyle = indicatorColor;
                ctx.lineWidth = 8;
                ctx.moveTo(leftAnkle.x * ctx.canvas.width, leftAnkle.y * ctx.canvas.height);
                ctx.lineTo(rightAnkle.x * ctx.canvas.width, rightAnkle.y * ctx.canvas.height);
                ctx.stroke();
            }

            if (this.stage === "down" && leftWrist.y > nose.y && rightWrist.y > nose.y && !legsSpread) {
                this.completeRepetition();
            }
        }
        else if (this.currentExercise === 'overheadpress') {
            const leftElbowAngle = this.calculateAngle(lm[11], lm[13], lm[15]);
            const rightElbowAngle = this.calculateAngle(lm[12], lm[14], lm[16]);
            const avgElbowAngle = (leftElbowAngle + rightElbowAngle) / 2;

            const midHip = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
            const midShoulder = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
            const verticalPoint = { x: midHip.x, y: midHip.y - 0.5 };
            const torsoAngle = this.calculateAngle(verticalPoint, midHip, midShoulder);

            if (torsoAngle > 20) {
                this.addPersistentFeedback("Overhead press: Straighten your back.");
                this.currentRepHasError = true;
                this.drawBodyLine(ctx, midShoulder, midHip, midHip, "red");
            }

            if (avgElbowAngle < 70) {
                checkStartTimer();
                this.stage = "down";
            }

            if (avgElbowAngle > 150 && this.stage === "down") {
                this.completeRepetition();
            }
        }

        this.drawFeedback(ctx, this.feedback);
    }

    // --- UTILITIES ---
    drawSkeleton(ctx, landmarks, w, h) {
        const connections = [
            [11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25],
            [25, 27], [24, 26], [26, 28], [28, 32], [28, 30], [30, 32], [27, 31], [27, 29], [29, 31]
        ];

        ctx.strokeStyle = "#00ffcc";
        ctx.lineWidth = 4;
        connections.forEach(([i, j]) => {
            const p1 = landmarks[i], p2 = landmarks[j];
            ctx.beginPath();
            ctx.moveTo(p1.x * w, p1.y * h);
            ctx.lineTo(p2.x * w, p2.y * h);
            ctx.stroke();
        });

        ctx.fillStyle = "#ff3d3d";
        landmarks.forEach(lm => {
            ctx.beginPath();
            ctx.arc(lm.x * w, lm.y * h, 6, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    drawAngleValues(ctx, lm, w, h) {
        const leftElbow = this.calculateAngle(lm[11], lm[13], lm[15]);
        const rightElbow = this.calculateAngle(lm[12], lm[14], lm[16]);
        const leftKnee = this.calculateAngle(lm[23], lm[25], lm[27]);
        const rightKnee = this.calculateAngle(lm[24], lm[26], lm[28]);
        const leftHip = this.calculateAngle(lm[11], lm[23], lm[25]);
        const rightHip = this.calculateAngle(lm[12], lm[24], lm[26]);

        this.drawAngleHighlight(ctx, leftElbow, lm[13]);
        this.drawAngleHighlight(ctx, rightElbow, lm[14]);
        this.drawAngleHighlight(ctx, leftKnee, lm[25]);
        this.drawAngleHighlight(ctx, rightKnee, lm[26]);
        this.drawAngleHighlight(ctx, leftHip, lm[23]);
        this.drawAngleHighlight(ctx, rightHip, lm[24]);
    }

    calculateAngle(a, b, c) {
        const ab = { x: a.x - b.x, y: a.y - b.y };
        const cb = { x: c.x - b.x, y: c.y - b.y };
        const dot = ab.x * cb.x + ab.y * cb.y;
        const magAB = Math.hypot(ab.x, ab.y);
        const magCB = Math.hypot(cb.x, cb.y);
        if (magAB === 0 || magCB === 0) return 0;
        let angle = Math.acos(Math.max(-1, Math.min(1, dot / (magAB * magCB))));
        return angle * (180 / Math.PI);
    }

    drawAngleHighlight(ctx, value, landmark) {
        ctx.fillStyle = "white";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 3;
        ctx.font = "bold 24px Arial";
        const x = landmark.x * ctx.canvas.width + 10;
        const y = landmark.y * ctx.canvas.height;
        ctx.strokeText(value.toFixed(0) + "°", x, y);
        ctx.fillText(value.toFixed(0) + "°", x, y);
    }

    checkHorizontal(p1, p2) {
        const dx = Math.abs(p1.x - p2.x);
        const dy = Math.abs(p1.y - p2.y);
        return dx > dy;
    }
    isFacingSideways(lm) {
        const shoulderDistX = Math.abs(lm[11].x - lm[12].x);
        const hipDistX = Math.abs(lm[23].x - lm[24].x);
        return shoulderDistX < 0.15 && hipDistX < 0.15;
    }

    drawFeedback(ctx, feedbackArray) {
        if (!feedbackArray || feedbackArray.length === 0) return;

        ctx.save();
        const padding = 15;
        const fontSize = 20;
        const lineSpacing = 10;
        ctx.font = `bold ${fontSize}px Arial`;

        let maxWidth = 0;
        feedbackArray.forEach(text => {
            const metrics = ctx.measureText(text);
            if (metrics.width > maxWidth) maxWidth = metrics.width;
        });

        const boxWidth = maxWidth + (padding * 2);
        const boxHeight = (feedbackArray.length * (fontSize + lineSpacing)) + padding;
        const x = ctx.canvas.width - boxWidth - 20;
        const y = 20;

        ctx.fillStyle = "rgba(255, 61, 61, 0.85)";
        ctx.beginPath();
        if (ctx.roundRect) { ctx.roundRect(x, y, boxWidth, boxHeight, 10); }
        else { ctx.rect(x, y, boxWidth, boxHeight); }
        ctx.fill();

        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "white";
        ctx.textBaseline = "top";
        ctx.shadowColor = "black";
        ctx.shadowBlur = 4;

        feedbackArray.forEach((text, index) => {
            const textY = y + padding + (index * (fontSize + lineSpacing));
            ctx.fillText(text, x + padding, textY);
        });

        ctx.restore();
    }

    drawBodyLine(ctx, shoulder, hip, ankle, color) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.moveTo(shoulder.x * ctx.canvas.width, shoulder.y * ctx.canvas.height);
        ctx.lineTo(hip.x * ctx.canvas.width, hip.y * ctx.canvas.height);
        ctx.lineTo(ankle.x * ctx.canvas.width, ankle.y * ctx.canvas.height);
        ctx.stroke();
    }

    drawPill(ctx, x, y, label, count, color) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x, y, 150, 50, 10);
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "white";
        ctx.font = "bold 16px Arial";
        ctx.fillText(label, x + 10, y + 32);
        ctx.font = "bold 26px Arial";
        ctx.fillText(count, x + 100, y + 35);
        ctx.restore();
    }

    addPersistentFeedback(msg) {
        if (!this.feedback.includes(msg)) {
            this.feedback.push(msg);
            this.detailedErrorCounts[msg] = (this.detailedErrorCounts[msg] || 0) + 1;
        }
    }

    completeRepetition() {
        if (this.repStartTime > 0) {
            const duration = (Date.now() - this.repStartTime) / 1000; // in seconds
            this.lastRepDuration = duration;
            this.repDurations.push(duration);
        }
        this.repStartTime = 0;
        this.stage = "up";

        if (this.currentRepHasError) {
            this.incorrectReps++;
        } else {
            this.correctReps++;
        }

        this.currentRepHasError = false;
        this.feedback = [];
    }

    drawCounter(ctx) {
        this.drawPill(ctx, 20, 20, "Correct", this.correctReps, "rgba(0, 255, 102, 0.8)");
        this.drawPill(ctx, 20, 80, "Incorrect", this.incorrectReps, "rgba(255, 61, 61, 0.8)");
        let displayTime = this.lastRepDuration.toFixed(1);
        if (this.stage === "down" && this.repStartTime > 0) {
            const current = (Date.now() - this.repStartTime) / 1000;
            displayTime = current.toFixed(1);
        }
        this.drawPill(ctx, 20, 140, "Time (s)", displayTime, "rgba(0, 153, 255, 0.8)");
    }
}