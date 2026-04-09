import { storage, db, auth } from "./firebase.js";
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-storage.js";
import { collection, addDoc, serverTimestamp, setDoc, doc, increment, getDoc, updateDoc, FieldPath } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

export class ReviewHandler {
    constructor(elements, callbacks) {
        this.container = elements.container;
        this.videoPlayer = elements.videoPlayer;
        this.exerciseNameEl = elements.exerciseNameEl;
        this.correctCountEl = elements.correctCountEl;
        this.incorrectCountEl = elements.incorrectCountEl;
        this.finalizeBtn = elements.finalizeBtn;
        this.discardBtn = elements.discardBtn;
        this.uploadStatus = elements.uploadStatus;

        this.onSessionComplete = callbacks.onSessionComplete || (() => { });
        this.currentBlob = null;
        this.metaData = {};

        this.initListeners();
    }

    initListeners() {
        this.finalizeBtn.addEventListener('click', () => this.handleUpload());
        this.discardBtn.addEventListener('click', () => this.handleDiscard());
    }

    show(videoBlob, data) {
        this.currentBlob = videoBlob;
        this.metaData = data;

        this.exerciseNameEl.innerText = data.exercise || "Unknown Exercise";
        if (this.correctCountEl) this.correctCountEl.innerText = data.correct || 0;
        if (this.incorrectCountEl) this.incorrectCountEl.innerText = data.incorrect || 0;

        this.injectDetailedStats(data);
        const localUrl = URL.createObjectURL(videoBlob);
        this.videoPlayer.src = localUrl;

        this.container.classList.remove('d-none');
        this.finalizeBtn.disabled = false;
        this.discardBtn.disabled = false;
        this.uploadStatus.classList.add('d-none');
    }

    injectDetailedStats(data) {
        const existingStats = document.getElementById('review-detailed-stats');
        if (existingStats) existingStats.remove();

        const avgTime = data.avgTime || "0.0";
        const errors = data.errorBreakdown || {};

        let errorListHtml = '';
        if (Object.keys(errors).length === 0) {
            errorListHtml = '<li class="list-group-item text-muted small">No form errors detected. Great job!</li>';
        } else {
            for (const [msg, count] of Object.entries(errors)) {
                errorListHtml += `
                    <li class="list-group-item d-flex justify-content-between align-items-center small py-1">
                        ${msg}
                        <span class="badge bg-danger rounded-pill">${count}</span>
                    </li>`;
            }
        }

        const statsHtml = `
            <div id="review-detailed-stats" class="mt-3 p-2 border rounded bg-light">
                <p class="mb-2"><strong>Avg Rep Time:</strong> ${avgTime}s</p>
                <p class="mb-1"><strong>Form Feedback Breakdown:</strong></p>
                <ul class="list-group list-group-flush mb-0">
                    ${errorListHtml}
                </ul>
            </div>
        `;

        const parentCol = this.incorrectCountEl.closest('.col-12');
        if (parentCol) {
            const videoWrapper = parentCol.querySelector('.pose-wrapper');
            videoWrapper.insertAdjacentHTML('beforebegin', statsHtml);
        }
    }

    hide() {
        if (this.videoPlayer.src) {
            URL.revokeObjectURL(this.videoPlayer.src);
            this.videoPlayer.src = "";
        }
        this.currentBlob = null;
        this.container.classList.add('d-none');

        const existingStats = document.getElementById('review-detailed-stats');
        if (existingStats) existingStats.remove();
    }

    async handleUpload() {
        const user = auth.currentUser;
        if (!user || !this.currentBlob) {
            alert("User not logged in or no video found.");
            return;
        }

        this.toggleButtons(true);
        this.uploadStatus.classList.remove('d-none');

        try {
            const uid = user.uid;
            const timestamp = Date.now();
            const filePath = `users/${uid}/sessions/${timestamp}_${uid}.webm`;
            const fileRef = ref(storage, filePath);

            const uploadTask = await uploadBytesResumable(fileRef, this.currentBlob);
            const downloadURL = await getDownloadURL(uploadTask.ref);

            const historyRef = collection(db, "users", uid, "stats", "summary", "history");
            await addDoc(historyRef, {
                uid: uid,
                exercise: this.metaData.exercise,
                correctReps: this.metaData.correct,
                incorrectReps: this.metaData.incorrect,
                avgRepTime: this.metaData.avgTime,
                errorBreakdown: this.metaData.errorBreakdown || {},
                videoUrl: downloadURL,
                createdAt: serverTimestamp()
            });

            const statsRef = doc(db, "users", uid, "stats", "summary");
            const statsSnap = await getDoc(statsRef);

            if (!statsSnap.exists()) {
                const initData = {
                    totalSessions: 1,
                    exerciseCounts: { [this.metaData.exercise]: 1 },
                    errorCounts: {}
                };
                if (this.metaData.errorBreakdown) {
                    for (const [errName, count] of Object.entries(this.metaData.errorBreakdown)) {
                        const numCount = Number(count);
                        if (!isNaN(numCount) && numCount > 0) initData.errorCounts[errName] = numCount;
                    }
                }
                await setDoc(statsRef, initData);
            } else {
                const updateArgs = [statsRef];

                updateArgs.push("totalSessions", increment(1));

                updateArgs.push(new FieldPath("exerciseCounts", this.metaData.exercise), increment(1));

                if (this.metaData.errorBreakdown) {
                    for (const [errorName, count] of Object.entries(this.metaData.errorBreakdown)) {
                        const numCount = Number(count);
                        if (!isNaN(numCount) && numCount > 0) {
                            // This is the CRITICAL fix: FieldPath escapes the trailing period
                            updateArgs.push(new FieldPath("errorCounts", errorName), increment(numCount));
                        }
                    }
                }
                await updateDoc(...updateArgs);
            }

            alert("Session saved successfully!");
            this.finishSession();

        } catch (error) {
            console.error("Upload Error:", error);
            alert("Failed to save results.");
            this.toggleButtons(false);
        }
    }

    handleDiscard() {
        if (confirm("Discard this session?")) {
            this.finishSession();
        }
    }

    finishSession() {
        this.hide();
        this.onSessionComplete();
    }

    toggleButtons(disabled) {
        this.finalizeBtn.disabled = disabled;
        this.discardBtn.disabled = disabled;
    }
}