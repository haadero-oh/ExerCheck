import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "loginwithgoogle.html";
  }
});
