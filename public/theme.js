// =========================================
// THEME TOGGLE
// =========================================

const savedTheme = localStorage.getItem("theme");

if (savedTheme === "light") {
    document.documentElement.classList.add("light-mode");
}

document.addEventListener("DOMContentLoaded", () => {

    const themeToggle = document.getElementById("themeToggle");

    if (!themeToggle) return;

    function updateThemeButton() {

        const isLight =
            document.documentElement.classList.contains("light-mode");

        const icon = themeToggle.querySelector(".theme-icon");

        if (icon) {
            icon.innerHTML = isLight
                ? '<i data-lucide="moon"></i>'
                : '<i data-lucide="sun"></i>';
        }

        const text = themeToggle.querySelector(".theme-text");

        if (text) {
            text.textContent = isLight
                ? "Dark Mode"
                : "Light Mode";
        }

        if (typeof lucide !== "undefined") {
            lucide.createIcons();
        }
    }

    updateThemeButton();

    themeToggle.addEventListener("click", () => {

        const isLight =
            document.documentElement.classList.toggle("light-mode");

        localStorage.setItem(
            "theme",
            isLight ? "light" : "dark"
        );

        updateThemeButton();
    });

});