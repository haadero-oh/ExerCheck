import { auth, db } from "./firebase.js";
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

const provider = new GoogleAuthProvider();
const googleLoginBtn = document.getElementById("googleLogin");

let isAuthenticating = false;

onAuthStateChanged(auth, (user) => {
    if (user && !isAuthenticating) {
        window.location.href = "dashboard.html";
    }
});

// 1. Pass the event object (e) into the function
googleLoginBtn.addEventListener("click", async (e) => {
    // 2. Prevent default form submission behavior
    e.preventDefault();

    isAuthenticating = true;
    googleLoginBtn.disabled = true;
    googleLoginBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Logging in...`;

    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        if (!user) throw new Error("No user returned from Google login");

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            await setDoc(userRef, {
                uid: user.uid,
                name: user.displayName || "Anonymous",
                email: user.email,
                photoURL: user.photoURL || "",
                createdAt: serverTimestamp()
            });
            console.log("✅ New user profile created");
        } else {
            console.log("ℹ️ User profile already exists");
            googleLoginBtn.disabled = false;
            googleLoginBtn.innerHTML = `<i class="bi bi-door-open-fill"></i> Log-in`;
        }
        // 3. Move the redirect INSIDE the try block, at the very end
        window.location.href = "dashboard.html";

    } catch (error) {
        console.error("❌ Google login / Firestore error:", error);
        isAuthenticating = false;
    }

});