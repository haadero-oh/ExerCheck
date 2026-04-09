import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

  const navbar = document.getElementById("mainNavbar");
  const dashboardItem = document.getElementById("dashboard-item");
  const loginItem = document.getElementById("login-item");
  const logoutItem = document.getElementById("logout-item");
  const logoutBtn = document.getElementById("logoutbtn");

  onAuthStateChanged(auth, (user) => {
    if (user) {
      dashboardItem.classList.remove("d-none");
      logoutItem.classList.remove("d-none");
      loginItem.classList.add("d-none");
    } else {
      dashboardItem.classList.add("d-none");
      logoutItem.classList.add("d-none");
      loginItem.classList.remove("d-none");
    }
    navbar.classList.remove("d-none");
  });

  logoutBtn.addEventListener("click", () => {
    signOut(auth);
    window.location.href = "index.html";
  });