const loginForm = document.getElementById("loginForm");
const errorMessage = document.getElementById("error-message");

loginForm.addEventListener("submit", async function (event) {

    event.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    errorMessage.textContent = "";

    if (!username || !password) {
        errorMessage.textContent =
            "Please enter your username and password.";
        return;
    }

    try {

        const response = await fetch("/api/login", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                username: username,
                password: password
            })

        });

        const data = await response.json();

        if (response.ok) {

            window.location.href = data.redirect;

        } else {

            errorMessage.textContent =
                data.message || "Login failed.";

        }

    } catch (error) {

        console.error(error);

        errorMessage.textContent =
            "Could not connect to the server.";

    }

});