const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");

const db = new sqlite3.Database("./database.db");

const username = "ADMIN1";
const password = "QQ67@%5Tngr";

bcrypt.hash(password, 10, (err, hash) => {

    if (err) {
        console.error("Password hashing error:", err);
        return;
    }

    db.run(
        `INSERT INTO users (username, password, role, active)
         VALUES (?, ?, ?, ?)`,
        [username, hash, "admin", 1],
        function (err) {

            if (err) {
                console.error("Error creating account:", err);
            } else {
                console.log("Admin account created successfully!");
                console.log("Username:", username);
            }

            db.close();
        }
    );

});