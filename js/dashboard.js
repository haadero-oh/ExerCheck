import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import {
    doc, collection, query, orderBy, limit, getDocs, getDoc, runTransaction, updateDoc, onSnapshot, deleteField, FieldPath
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";
import { getStorage, ref, deleteObject, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-storage.js";

const storage = getStorage();

let unsubscribeProfile = null;
let unsubscribeStats = null;
let exerciseChartInstance = null;
let errorChartInstance = null;
let currentLimit = 10;

// --- UI UPDATE FUNCTIONS ---

function updateProfileUI(profile) {
    const profilePic = document.getElementById("userprofilepicture");
    const username = document.getElementById("username");

    if (profilePic) profilePic.src = profile.photoURL || "assets/default-avatar.png";
    if (username) username.textContent = `Hello, ${profile.name}!` || "Anonymous";
}

function renderSessionTable(sessions) {
    const tbody = document.getElementById("sessionTableBody");
    const noDataMsg = document.getElementById("noDataMessage");

    if (!tbody) return;
    tbody.innerHTML = "";

    if (sessions.length === 0) {
        if (noDataMsg) noDataMsg.classList.remove("d-none");
        return;
    } else {
        if (noDataMsg) noDataMsg.classList.add("d-none");
    }

    sessions.forEach(session => {
        const row = document.createElement("tr");
        const avgTimeValue = parseFloat(session.avgRepTime);
        const displayTime = !isNaN(avgTimeValue) ? avgTimeValue.toFixed(2) + "s" : "-";

        let dateStr = "N/A";
        if (session.createdAt && session.createdAt.seconds) {
            dateStr = new Date(session.createdAt.seconds * 1000).toLocaleDateString() + " " +
                new Date(session.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        row.innerHTML = `
            <td>${dateStr}</td>
            <td class="fw-bold">${session.exercise || "Unknown"}</td>
            <td class=" fw-bold">${session.correctReps || 0}</td>
            <td class=" fw-bold">${session.incorrectReps || 0}</td>
            <td>${displayTime}</td>
        `;

        const actionCell = document.createElement("td");
        const wrapper = document.createElement("div");
        wrapper.className = "d-flex align-items-center gap-2";

        const videoBtn = session.videoUrl
            ? `<a href="${session.videoUrl}" target="_blank" class="btn btn-custom-green"><i class="bi bi-play-circle"></i> Play</a>`
            : `<span class="text-muted text-sm">No Video</span>`;

        wrapper.innerHTML = videoBtn;

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn btn-custom-green";
        deleteBtn.innerHTML = `<i class="bi bi-trash"></i> Delete`;
        deleteBtn.title = "Delete Session";

        deleteBtn.addEventListener("click", (e) => {
            const originalHtml = deleteBtn.innerHTML;
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;

            deleteSession(session.id).finally(() => {
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = originalHtml;
            });
        });

        wrapper.appendChild(deleteBtn);
        actionCell.appendChild(wrapper);
        row.appendChild(actionCell);
        tbody.appendChild(row);
    });
}
function renderStatistics(statsData) {
    if (typeof Chart === 'undefined') return;

    const exerciseCounts = statsData.exerciseCounts || {};
    const errorCounts = statsData.errorCounts || {};

    const ctxEx = document.getElementById('exerciseChart');
    if (ctxEx) {
        if (exerciseChartInstance) exerciseChartInstance.destroy();

        const labels = Object.keys(exerciseCounts);
        const values = Object.values(exerciseCounts);

        exerciseChartInstance = new Chart(ctxEx, {
            type: 'bar',
            data: {
                labels: labels.length > 0 ? labels : ['No Exercises'],
                datasets: [{
                    label: 'Sessions',
                    data: values.length > 0 ? values : [0],
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                scales: { y: { beginAtZero: true, ticks: { color: 'white' } }, x: { ticks: { color: 'white' } } },
                plugins: { legend: { labels: { color: 'white' } } }
            }
        });
    }

    const ctxErr = document.getElementById('errorChart');
    if (ctxErr) {
        if (errorChartInstance) errorChartInstance.destroy();

        const labels = Object.keys(errorCounts);
        const values = Object.values(errorCounts);
        const hasErrors = labels.length > 0;

        errorChartInstance = new Chart(ctxErr, {
            type: 'doughnut',
            data: {
                labels: hasErrors ? labels : ['Perfect Form (No Errors)'],
                datasets: [{
                    data: hasErrors ? values : [1],
                    backgroundColor: hasErrors ?
                        ['#ff6384', '#36a2eb', '#ffce56', '#9966ff', '#4bc0c0'] :
                        ['rgba(40, 167, 69, 0.8)'], // Return to GREEN light state
                    borderWidth: 0
                }]
            },
            options: {
                plugins: {
                    legend: { position: 'bottom', labels: { color: 'white' } }
                }
            }
        });
    }
}

async function loadSessions(user, limitCount) {
    const sessionsRef = collection(db, "users", user.uid, "stats", "summary", "history");
    const q = query(sessionsRef, orderBy("createdAt", "desc"), limit(limitCount));

    try {
        const snapshot = await getDocs(q);
        const sessions = [];
        snapshot.forEach((doc) => {
            sessions.push({ id: doc.id, ...doc.data() });
        });

        renderSessionTable(sessions);

        const loadMoreBtn = document.getElementById("loadMoreBtn");
        if (loadMoreBtn) {
            loadMoreBtn.classList.toggle("d-none", sessions.length < limitCount);
        }
    } catch (error) {
        console.error("Error fetching sessions:", error);
    }
}

async function deleteSession(sessionId) {
    const user = auth.currentUser;
    if (!user) return;

    if (!confirm("Are you sure? This will delete the video and update your stats.")) {
        return;
    }

    const sessionRef = doc(db, "users", user.uid, "stats", "summary", "history", sessionId);
    const summaryRef = doc(db, "users", user.uid, "stats", "summary");

    try {
        const sessionSnap = await getDoc(sessionRef);
        if (!sessionSnap.exists()) return;
        const sessionData = sessionSnap.data();

        if (sessionData.videoUrl) {
            try {
                const videoRef = ref(storage, sessionData.videoUrl);
                await deleteObject(videoRef);
            } catch (e) { console.warn("Video cleanup failed:", e); }
        }

        await runTransaction(db, async (transaction) => {
            const summaryDoc = await transaction.get(summaryRef);
            if (!summaryDoc.exists()) return;

            const summaryData = summaryDoc.data();
            const updateArgs = [summaryRef];

            const newTotal = Math.max(0, (summaryData.totalSessions || 0) - 1);
            updateArgs.push("totalSessions", newTotal);

            const exName = sessionData.exercise;
            if (exName && summaryData.exerciseCounts && summaryData.exerciseCounts[exName]) {
                const currentExCount = summaryData.exerciseCounts[exName];
                const exPath = new FieldPath("exerciseCounts", exName);
                if (currentExCount > 1) {
                    updateArgs.push(exPath, currentExCount - 1);
                } else {
                    updateArgs.push(exPath, deleteField());
                }
            }

            if (sessionData.errorBreakdown && summaryData.errorCounts) {
                Object.keys(sessionData.errorBreakdown).forEach(errType => {
                    const currentErrCount = summaryData.errorCounts[errType];
                    if (currentErrCount !== undefined) {
                        const deductAmount = sessionData.errorBreakdown[errType] || 0;
                        const newCount = currentErrCount - deductAmount;
                        const errPath = new FieldPath("errorCounts", errType);

                        if (newCount > 0) {
                            updateArgs.push(errPath, newCount);
                        } else {
                            updateArgs.push(errPath, deleteField());
                        }
                    }
                });
            }

            transaction.delete(sessionRef);
            if (updateArgs.length > 1) {
                transaction.update(...updateArgs);
            }
        });

        loadSessions(user, currentLimit);
    } catch (error) {
        console.error("Deletion failed:", error);
        alert("Failed to delete session.");
    }
}

const saveProfileBtn = document.getElementById("saveProfileBtn");
if (saveProfileBtn) {
    saveProfileBtn.addEventListener("click", async () => {
        const user = auth.currentUser;
        if (!user) return;
        const nameInput = document.getElementById("editNameInput").value.trim();
        const fileInput = document.getElementById("editPicInput").files[0];

        if (!nameInput) return alert("Name required.");

        saveProfileBtn.disabled = true;
        saveProfileBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Saving...`;

        try {
            const userRef = doc(db, "users", user.uid);

            // 1. Fetch current data to find the old photo URL
            const userSnap = await getDoc(userRef);
            const userData = userSnap.data() || {};
            let updateData = { name: nameInput };

            if (fileInput) {
                // 2. If an old photo exists, delete it from Storage
                if (userData.photoURL) {
                    try {
                        const oldFileRef = ref(storage, userData.photoURL);
                        await deleteObject(oldFileRef);
                    } catch (e) {
                        // We log a warning but don't stop the process if deletion fails 
                        // (e.g., if the file was already manually deleted)
                        console.warn("Old profile picture cleanup failed:", e);
                    }
                }

                // 3. Upload the new squared image
                const squaredBlob = await cropToSquare(fileInput);
                const fileRef = ref(storage, `users/${user.uid}/profile_picture/${user.uid}_${Date.now()}`);
                await uploadBytes(fileRef, squaredBlob);
                updateData.photoURL = await getDownloadURL(fileRef);
            }

            // 4. Update Firestore with the new name and (potentially) new URL
            await updateDoc(userRef, updateData);

            // Hide modal
            const modalEl = document.getElementById("editProfileModal");
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();

        } catch (error) {
            console.error("Profile update failed:", error);
            alert("Failed to update profile.");
        } finally {
            saveProfileBtn.disabled = false;
            saveProfileBtn.innerText = "Save Changes";
        }
    });
}

async function cropToSquare(file) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            const canvas = document.createElement("canvas");
            const size = 200;
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext("2d");
            let sX = 0, sY = 0, sW = img.width, sH = img.height;
            if (img.width > img.height) { sW = img.height; sX = (img.width - img.height) / 2; }
            else { sH = img.width; sY = (img.height - img.width) / 2; }
            ctx.drawImage(img, sX, sY, sW, sH, 0, 0, size, size);
            canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.9);
        };
    });
}

// --- AUTH STATE LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (unsubscribeProfile) unsubscribeProfile();
    if (unsubscribeStats) unsubscribeStats();

    if (user) {
        currentLimit = 10;
        loadSessions(user, currentLimit);

        const profileRef = doc(db, "users", user.uid);
        unsubscribeProfile = onSnapshot(profileRef, (doc) => {
            if (doc.exists()) {
                const profileData = doc.data();
                updateProfileUI(profileData);

                // Prefill the modal input field
                const editNameInput = document.getElementById("editNameInput");
                if (editNameInput) {
                    editNameInput.value = profileData.name || "";
                }
            }
        });

        const statsRef = doc(db, "users", user.uid, "stats", "summary");
        unsubscribeStats = onSnapshot(statsRef, (doc) => {
            renderStatistics(doc.exists() ? doc.data() : {});
        });

        const loadMoreBtn = document.getElementById("loadMoreBtn");
        if (loadMoreBtn) {
            loadMoreBtn.onclick = () => { currentLimit += 10; loadSessions(user, currentLimit); };
        }
    } else {
        updateProfileUI({});
        if (exerciseChartInstance) exerciseChartInstance.destroy();
        if (errorChartInstance) errorChartInstance.destroy();
    }
});