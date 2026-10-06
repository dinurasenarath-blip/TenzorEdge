require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// =========================================
// POSTGRESQL DATABASE CONNECTION
// =========================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});


// =========================================
// SQLITE-COMPATIBLE DATABASE LAYER
// =========================================

const db = {

    // -----------------------------------------
    // db.get()
    // -----------------------------------------
    get: async function (sql, params = [], callback) {

        try {

            const pgSql = convertPlaceholders(sql);

            const result = await pool.query(pgSql, params);

            const row = result.rows[0];

            if (callback) {
                callback.call(
                    {
                        lastID: row?.id,
                        changes: result.rowCount
                    },
                    null,
                    row
                );
            }

        } catch (err) {

            if (callback) {
                callback.call(
    {
        lastID: undefined,
        changes: 0
    },
    normalizePostgresError(err)
);
            } else {
                console.error("Database error:", err);
            }

        }

    },


    // -----------------------------------------
    // db.all()
    // -----------------------------------------
    all: async function (sql, params = [], callback) {

        try {

            const pgSql = convertPlaceholders(sql);

            const result = await pool.query(pgSql, params);

            if (callback) {
                callback(null, result.rows);
            }

        } catch (err) {

            if (callback) {
                callback(normalizePostgresError(err));
            } else {
                console.error("Database error:", err);
            }

        }

    },


    // -----------------------------------------
    // db.run()
    // -----------------------------------------
    run: async function (sql, params = [], callback) {

        try {

            let pgSql = convertPlaceholders(sql);

            /*
             * PostgreSQL doesn't automatically return the
             * inserted ID like SQLite's lastID.
             *
             * We'll handle INSERT statements separately
             * when needed.
             */

            const result = await pool.query(pgSql, params);

            if (callback) {

                callback.call(
                    {
                        lastID: result.rows[0]?.id,
                        changes: result.rowCount
                    },
                    null
                );

            }

        } catch (err) {

            if (callback) {
                callback.call(
    {
        lastID: undefined,
        changes: 0
    },
    normalizePostgresError(err)
);
            } else {
                console.error("Database error:", err);
            }

        }

    }

};


// SQLITE ? → POSTGRESQL $1, $2, $3...
function convertPlaceholders(sql) {
    let index = 0;
    return sql.replace(/\?/g, () => {
        index++;
        return `$${index}`;
    });
}

// Convert PostgreSQL errors into SQLite-style messages
// so the existing routes continue working.
function normalizePostgresError(err) {
    if (err?.code === "23505") {
        const e = new Error("UNIQUE constraint failed");
        e.code = err.code;
        e.detail = err.detail;
        e.original = err;
        return e;
    }

    if (err?.code === "23503") {
        const e = new Error("FOREIGN KEY constraint failed");
        e.code = err.code;
        e.detail = err.detail;
        e.original = err;
        return e;
    }

    return err;
}


// =========================================
// TEST DATABASE CONNECTION
// =========================================

pool.query("SELECT NOW()", (err, result) => {

    if (err) {

        console.error("❌ PostgreSQL connection failed:");
        console.error(err);

    } else {

        console.log("✅ PostgreSQL connection successful!");

    }

});


// =========================================
// EXPRESS SETUP
// =========================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: process.env.SESSION_SECRET || "tenzoredge-secret",
        resave: false,
        saveUninitialized: false
    })
);

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/login", (req, res) => {

    const {
        username,
        password
    } = req.body;


    if (!username || !password) {

        return res.status(400).json({

            message:
                "Please enter your username and password."

        });

    }


    db.get(

        "SELECT * FROM users WHERE username = ?",

        [username],

        async (err, user) => {

            if (err) {

                console.error(err);

                return res.status(500).json({

                    message:
                        "Server error."

                });

            }


            if (!user) {

                return res.status(401).json({

                    message:
                        "Invalid username or password."

                });

            }


            if (!user.active) {

                return res.status(403).json({

                    message:
                        "This account has been disabled."

                });

            }


            const passwordCorrect =
    await bcrypt.compare(
        password,
        user.password
    );

    console.log("Password correct:", passwordCorrect);
console.log("=== LOGIN DEBUG END ===");

console.log("LOGIN DEBUG:", {
    username: user.username,
    hashLength: user.password?.length,
    passwordLength: password?.length,
    passwordCorrect
});


            if (!passwordCorrect) {

                return res.status(401).json({

                    message:
                        "Invalid username or password."

                });

            }


            // Create login session

            req.session.userId =
                user.id;

            req.session.username =
                user.username;

            req.session.role =
                user.role;

            req.session.package =
                user.package;


            let redirect;

if (user.role === "admin") {

    redirect = "/dashboard.html";

} else {

    redirect = "/customer-dashboard.html";

}


res.json({

    success: true,

    redirect: redirect

});

        }

    );

});

// ==========================================
// CREATE CUSTOMER ACCOUNT
// ==========================================

app.post("/api/admin/create-customer", async (req, res) => {

    // Make sure the person creating the account is an admin

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }


 const {
    name,
    email,
    username,
    password,
    package: customerPackage
} = req.body;


    // Check required information

    if (!name || !email || !username || !password) {

    return res.status(400).json({
        message: "Name, email, username and password are required."
    });

}


    // Allowed packages

    const allowedPackages = [
        "basic",
        "smc",
        "elliot_wave"
    ];


    if (
        !customerPackage ||
        !allowedPackages.includes(customerPackage)
    ) {

        return res.status(400).json({
            message: "A valid package is required."
        });

    }


    try {

        // Hash password

        const hashedPassword =
            await bcrypt.hash(password, 10);


        // Create customer account

db.run(
    `
    INSERT INTO users
(name, email, username, password, role, package, active)
VALUES (?, ?, ?, ?, 'customer', ?, 1)
RETURNING id
    `,
            [
    name.trim(),
    email.trim(),
    username.trim(),
    hashedPassword,
    customerPackage
],

            function (err) {

                if (err) {

                    if (
                        err.message.includes(
                            "UNIQUE constraint failed"
                        )
                    ) {

                        return res.status(409).json({
                            message:
                                "That username already exists."
                        });

                    }


                    console.error(err);

                    return res.status(500).json({
                        message:
                            "Could not create customer."
                    });

                }


                const userId =
                    this.lastID;


                // Match package to course title

                let courseTitle;


                if (customerPackage === "basic") {

                    courseTitle =
                        "Trading Fundamentals";

                } else if (customerPackage === "smc") {

                    courseTitle =
                        "Smart Money Concepts";

                } else if (customerPackage === "elliot_wave") {

                    courseTitle =
                        "Elliot Wave";

                }


                // Find the matching course

                db.get(
                    `
                    SELECT id
                    FROM courses
                    WHERE title = ?
                    `,
                    [courseTitle],

                    (err, course) => {

                        if (err) {

                            console.error(err);

                            return res.status(500).json({
                                message:
                                    "Customer created, but course lookup failed."
                            });

                        }


                        if (!course) {

                            return res.status(500).json({
                                message:
                                    "Customer created, but assigned course was not found."
                            });

                        }


                        // Assign course to customer

                        db.run(
                            `
                            INSERT INTO user_courses
                            (user_id, course_id, progress)
                            VALUES (?, ?, 0)
                            `,
                            [
                                userId,
                                course.id
                            ],

                            function (err) {

                                if (err) {

                                    console.error(err);

                                    return res.status(500).json({
                                        message:
                                            "Customer created, but course assignment failed."
                                    });

                                }


                                res.json({

                                    success: true,

                                    message:
                                        "Customer account created and course assigned.",

                                    userId:
                                        userId,

                                    courseId:
                                        course.id

                                });

                            }

                        );

                    }

                );

            }

        );

    } catch (error) {

        console.error(error);

        res.status(500).json({

            message:
                "Could not create customer."

        });

    }

});


// ==========================================
// CHECK CURRENT USER
// ==========================================

app.get("/api/me", (req, res) => {

    if (!req.session.userId) {

        return res.status(401).json({

            loggedIn: false

        });

    }


    res.json({

        loggedIn: true,

        user: {

            id:
                req.session.userId,

            username:
                req.session.username,

            role:
                req.session.role

        }

    });

});

// ==========================================
// GET CUSTOMER ACCOUNT DETAILS
// ==========================================

app.get("/api/customer/account", (req, res) => {

    // Make sure a customer is logged in

    if (
        !req.session.userId ||
        req.session.role !== "customer"
    ) {

        return res.status(403).json({
            message: "Customer access required."
        });

    }

    db.get(
        `
        SELECT
            id,
            name,
            email,
            username,
            role,
            package
        FROM users
        WHERE id = ?
        `,
        [req.session.userId],

        (err, user) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not retrieve account details."
                });

            }

            if (!user) {

                return res.status(404).json({
                    message:
                        "User account not found."
                });

            }

            res.json({

                success: true,

                user: user

            });

        }
    );

});

// ==========================================
// GET CUSTOMER REVIEW
// ==========================================

app.get("/api/customer/review", (req, res) => {

    // Make sure a customer is logged in

    if (
        !req.session.userId ||
        req.session.role !== "customer"
    ) {

        return res.status(403).json({
            message: "Customer access required."
        });

    }


    db.get(
        `
        SELECT
            id,
            rating,
            review,
            status,
            created_at
        FROM reviews
        WHERE user_id = ?
        `,
        [req.session.userId],

        (err, review) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not retrieve your review."
                });

            }


            res.json({

                success: true,

                review: review || null

            });

        }
    );

});

// ==========================================
// GET APPROVED REVIEWS
// ==========================================

app.get("/api/customer/approved-reviews", (req, res) => {

    db.all(`
        SELECT
            reviews.id,
            reviews.rating,
            reviews.review,
            reviews.created_at,
            users.username,
            users.name
        FROM reviews
        JOIN users ON reviews.user_id = users.id
        WHERE reviews.status = 'approved'
        ORDER BY reviews.created_at DESC
    `, [], (err, reviews) => {

        if (err) {
            console.error(err);

            return res.status(500).json({
                message: "Could not retrieve approved reviews."
            });
        }

        res.json({
            success: true,
            reviews: reviews
        });

    });

});

// ==========================================
// SUBMIT / UPDATE CUSTOMER REVIEW
// ==========================================

app.post("/api/customer/review", (req, res) => {

    // Make sure a customer is logged in

    if (
        !req.session.userId ||
        req.session.role !== "customer"
    ) {

        return res.status(403).json({
            message: "Customer access required."
        });

    }


    const userId =
        req.session.userId;

    const rating =
        Number(req.body.rating);

    const review =
        req.body.review?.trim();


    // Validate rating

    if (
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5
    ) {

        return res.status(400).json({
            message:
                "Please select a rating between 1 and 5 stars."
        });

    }


    // Validate review text

    if (!review) {

        return res.status(400).json({
            message:
                "Please write a review."
        });

    }


    if (review.length > 1000) {

        return res.status(400).json({
            message:
                "Your review cannot exceed 1000 characters."
        });

    }


    // Check whether this customer
    // already has a review

    db.get(
        `
        SELECT id
        FROM reviews
        WHERE user_id = ?
        `,
        [userId],

        (err, existingReview) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not check your existing review."
                });

            }


            // ------------------------------------------
            // UPDATE EXISTING REVIEW
            // ------------------------------------------

            if (existingReview) {

                db.run(
                    `
                    UPDATE reviews

                    SET
                        rating = ?,
                        review = ?,
                        status = 'pending',
                        created_at = CURRENT_TIMESTAMP

                    WHERE user_id = ?
                    `,
                    [
                        rating,
                        review,
                        userId
                    ],

                    function (err) {

                        if (err) {

                            console.error(err);

                            return res.status(500).json({
                                message:
                                    "Could not update your review."
                            });

                        }


                        return res.json({

                            success: true,

                            message:
                                "Your review has been updated and sent for approval."

                        });

                    }
                );

                return;
            }


            // ------------------------------------------
            // CREATE NEW REVIEW
            // ------------------------------------------

            db.run(
                `
                INSERT INTO reviews
(
    user_id,
    rating,
    review,
    status
)

VALUES (?, ?, ?, 'pending')
RETURNING id
                `,
                [
                    userId,
                    rating,
                    review
                ],

                function (err) {

                    if (err) {

                        console.error(err);

                        return res.status(500).json({
                            message:
                                "Could not save your review."
                        });

                    }


                    res.json({

                        success: true,

                        message:
                            "Your review has been submitted for approval.",

                        reviewId:
                            this.lastID

                    });

                }
            );

        }
    );

});

// ==========================================
// DELETE CUSTOMER'S OWN REVIEW
// ==========================================

app.delete("/api/customer/review", (req, res) => {

    if (!req.session.userId) {
        return res.status(401).json({
            message: "You must be logged in."
        });
    }

    db.run(
        `
        DELETE FROM reviews
        WHERE user_id = ?
        `,
        [req.session.userId],
        function (err) {

            if (err) {
                console.error(err);

                return res.status(500).json({
                    message: "Could not delete review."
                });
            }

            if (this.changes === 0) {
                return res.status(404).json({
                    message: "No review found."
                });
            }

            res.json({
                success: true,
                message: "Your review has been deleted."
            });

        }
    );

});

// ==========================================
// GET USER DETAILS - ADMIN ONLY
// ==========================================

app.get("/api/admin/users/:id", (req, res) => {

    // Make sure the person viewing the user is an admin

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }


    const userId = req.params.id;


    // Get the user

    db.get(
        `
        SELECT
            id,
            username,
            role,
            package,
            active
        FROM users
        WHERE id = ?
        `,
        [userId],

        (err, user) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message: "Could not retrieve user."
                });

            }


            if (!user) {

                return res.status(404).json({
                    message: "User not found."
                });

            }


            // Get the user's courses

            db.all(
                `
                SELECT
                    courses.id,
                    courses.title,
                    courses.description,
                    user_courses.progress
                FROM user_courses

                JOIN courses
                    ON user_courses.course_id = courses.id

                WHERE user_courses.user_id = ?

                ORDER BY courses.title
                `,
                [userId],

                (err, courses) => {

                    if (err) {

                        console.error(err);

                        return res.status(500).json({
                            message:
                                "Could not retrieve user courses."
                        });

                    }


                    res.json({

                        success: true,

                        user: user,

                        courses: courses

                    });

                }
            );

        }
    );

});

// ==========================================
// ADMIN - GET CUSTOMER PAYMENT DETAILS
// ==========================================

app.get("/api/admin/users/:id/payments", (req, res) => {

    if (!req.session.userId || req.session.role !== "admin") {
        return res.status(403).json({
            message: "Admin access required."
        });
    }

    const userId = req.params.id;

    const sql = `
        SELECT
            c.id AS course_id,
            c.title AS course_title,
            COALESCE(cp.total_fee, 0) AS total_fee,
            COALESCE(cp.amount_paid, 0) AS amount_paid
        FROM user_courses uc
        JOIN courses c
            ON c.id = uc.course_id
        LEFT JOIN course_payments cp
            ON cp.user_id = uc.user_id
            AND cp.course_id = uc.course_id
        WHERE uc.user_id = ?
        ORDER BY c.id
    `;

    db.all(sql, [userId], (err, payments) => {

        if (err) {

            console.error(err);

            return res.status(500).json({
                message: "Could not load payment details."
            });

        }

        const result = payments.map(payment => {

            const totalFee =
                Number(payment.total_fee) || 0;

            const amountPaid =
                Number(payment.amount_paid) || 0;

            const remaining =
                Math.max(totalFee - amountPaid, 0);

            const percentage =
                totalFee > 0
                    ? Math.min(
                        Math.round(
                            (amountPaid / totalFee) * 100
                        ),
                        100
                    )
                    : 0;

            return {
                course_id: payment.course_id,
                course_title: payment.course_title,
                total_fee: totalFee,
                amount_paid: amountPaid,
                remaining: remaining,
                percentage: percentage
            };

        });

        res.json({
            payments: result
        });

    });

});


// ==========================================
// ADMIN - SAVE CUSTOMER PAYMENT DETAILS
// ==========================================

app.post("/api/admin/users/:id/payments", (req, res) => {

    if (!req.session.userId || req.session.role !== "admin") {
        return res.status(403).json({
            message: "Admin access required."
        });
    }

    const userId =
        req.params.id;

    const {
        course_id,
        total_fee,
        amount_paid
    } = req.body;

    const courseId =
        Number(course_id);

    const totalFee =
        Number(total_fee);

    const amountPaid =
        Number(amount_paid);


    // ==========================================
    // VALIDATION
    // ==========================================

    if (!courseId) {

        return res.status(400).json({
            message: "Please select a course."
        });

    }

    if (
        !Number.isFinite(totalFee) ||
        totalFee < 0
    ) {

        return res.status(400).json({
            message: "Total course fee must be a valid amount."
        });

    }

    if (
        !Number.isFinite(amountPaid) ||
        amountPaid < 0
    ) {

        return res.status(400).json({
            message: "Amount paid must be a valid amount."
        });

    }

    if (amountPaid > totalFee) {

        return res.status(400).json({
            message:
                "Amount paid cannot be greater than the total course fee."
        });

    }


    // ==========================================
    // MAKE SURE CUSTOMER HAS THIS COURSE
    // ==========================================

    db.get(
        `
        SELECT *
        FROM user_courses
        WHERE user_id = ?
        AND course_id = ?
        `,
        [userId, courseId],
        (err, enrollment) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message: "Database error."
                });

            }

            if (!enrollment) {

                return res.status(400).json({
                    message:
                        "This customer is not assigned to that course."
                });

            }


            // ==========================================
            // SAVE PAYMENT
            // ==========================================

            db.run(
                `
                INSERT INTO course_payments
                    (user_id, course_id, total_fee, amount_paid)

                VALUES
                    (?, ?, ?, ?)

                ON CONFLICT(user_id, course_id)
                DO UPDATE SET
                    total_fee = excluded.total_fee,
                    amount_paid = excluded.amount_paid
                `,
                [
                    userId,
                    courseId,
                    totalFee,
                    amountPaid
                ],
                function (err) {

                    if (err) {

                        console.error(err);

                        return res.status(500).json({
                            message:
                                "Could not save payment details."
                        });

                    }

                    res.json({
                        message:
                            "Payment details saved successfully.",
                        total_fee: totalFee,
                        amount_paid: amountPaid,
                        remaining:
                            totalFee - amountPaid
                    });

                }
            );

        }
    );

});

// ==========================================
// GET ALL CUSTOMERS - ADMIN ONLY
// ==========================================

app.get("/api/admin/customers", (req, res) => {

    // Make sure the person viewing the customers is an admin

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }


    // Get all customer accounts

    db.all(
        `
        SELECT
            id,
            username,
            package,
            active
        FROM users
        WHERE role = 'customer'
        ORDER BY username ASC
        `,
        [],
        (err, customers) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not retrieve customers."
                });

            }


            res.json({

                success: true,

                customers: customers

            });

        }
    );

});

// ==========================================
// EDIT USER - ADMIN ONLY
// ==========================================

app.put("/api/admin/users/:id", (req, res) => {

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }

    const userId = req.params.id;
    const username = req.body.username;

    if (!username || !username.trim()) {

        return res.status(400).json({
            message: "Username is required."
        });

    }

    db.run(
        `
        UPDATE users
        SET username = ?
        WHERE id = ?
        AND role = 'customer'
        `,
        [
            username.trim(),
            userId
        ],

        function (err) {

            if (err) {

                if (
                    err.message.includes(
                        "UNIQUE constraint failed"
                    )
                ) {

                    return res.status(409).json({
                        message:
                            "That username is already being used."
                    });

                }

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not update user."
                });

            }

            if (this.changes === 0) {

                return res.status(404).json({
                    message:
                        "Customer not found."
                });

            }

            res.json({

                success: true,

                message:
                    "User details updated successfully."

            });

        }
    );

});

// ==========================================
// SUSPEND / REACTIVATE USER - ADMIN ONLY
// ==========================================

app.put("/api/admin/users/:id/status", (req, res) => {

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }

    const userId = req.params.id;

    db.get(
        `
        SELECT id, active
        FROM users
        WHERE id = ?
        AND role = 'customer'
        `,
        [userId],

        (err, user) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not retrieve user."
                });

            }

            if (!user) {

                return res.status(404).json({
                    message:
                        "Customer not found."
                });

            }

            const newStatus =
                user.active ? 0 : 1;

            db.run(
                `
                UPDATE users
                SET active = ?
                WHERE id = ?
                `,
                [
                    newStatus,
                    userId
                ],

                function (err) {

                    if (err) {

                        console.error(err);

                        return res.status(500).json({
                            message:
                                "Could not update account status."
                        });

                    }

                    res.json({

                        success: true,

                        active: newStatus,

                        message:
                            newStatus
                                ? "Account reactivated."
                                : "Account suspended."

                    });

                }
            );

        }
    );

});

// ==========================================
// DELETE CUSTOMER ACCOUNT - ADMIN ONLY
// ==========================================

app.delete("/api/admin/users/:id", (req, res) => {

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }

    const userId = req.params.id;

    // Make sure this is a customer account

    db.get(
        `
        SELECT id, username
        FROM users
        WHERE id = ?
        AND role = 'customer'
        `,
        [userId],

        (err, user) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not find customer."
                });

            }

            if (!user) {

                return res.status(404).json({
                    message:
                        "Customer not found."
                });

            }

            // Delete related data first

            db.run(
                `
                DELETE FROM user_lesson_progress
                WHERE user_id = ?
                `,
                [userId],

                (err) => {

                    if (err) {

                        console.error(err);

                        return res.status(500).json({
                            message:
                                "Could not remove lesson progress."
                        });

                    }

                    db.run(
                        `
                        DELETE FROM user_courses
                        WHERE user_id = ?
                        `,
                        [userId],

                        (err) => {

                            if (err) {

                                console.error(err);

                                return res.status(500).json({
                                    message:
                                        "Could not remove course assignments."
                                });

                            }

                            db.run(
                                `
                                DELETE FROM password_requests
                                WHERE user_id = ?
                                `,
                                [userId],

                                (err) => {

                                    if (err) {

                                        console.error(err);

                                        return res.status(500).json({
                                            message:
                                                "Could not remove password requests."
                                        });

                                    }

                                    // Finally delete the user

                                    db.run(
                                        `
                                        DELETE FROM users
                                        WHERE id = ?
                                        AND role = 'customer'
                                        `,
                                        [userId],

                                        function (err) {

                                            if (err) {

                                                console.error(err);

                                                return res.status(500).json({
                                                    message:
                                                        "Could not delete customer."
                                                });

                                            }

                                            res.json({

                                                success: true,

                                                message:
                                                    "Customer account deleted successfully."

                                            });

                                        }
                                    );

                                }
                            );

                        }
                    );

                }
            );

        }
    );

});

// ==========================================
// RESET USER COURSE PROGRESS - ADMIN ONLY
// ==========================================

app.put(
    "/api/admin/users/:id/progress",
    (req, res) => {

        if (
            !req.session.userId ||
            req.session.role !== "admin"
        ) {

            return res.status(403).json({
                message: "Admin access required."
            });

        }

        const userId =
            req.params.id;

        db.run(
            `
            UPDATE user_courses
            SET progress = 0
            WHERE user_id = ?
            `,
            [userId],

            function (err) {

                if (err) {

                    console.error(err);

                    return res.status(500).json({
                        message:
                            "Could not reset course progress."
                    });

                }

                // Reset individual lesson progress too

                db.run(
                    `
                    DELETE FROM user_lesson_progress
                    WHERE user_id = ?
                    `,
                    [userId],

                    function (err) {

                        if (err) {

                            console.error(err);

                            return res.status(500).json({
                                message:
                                    "Course progress was reset, but lesson progress could not be cleared."
                            });

                        }

                        res.json({

                            success: true,

                            message:
                                "Course progress reset successfully."

                        });

                    }
                );

            }
        );

    }
);

// ==========================================
// GET ALL COURSES - ADMIN ONLY
// ==========================================

app.get("/api/admin/courses", (req, res) => {

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }


    db.all(
        `
        SELECT
            id,
            title,
            description
        FROM courses
        ORDER BY title ASC
        `,
        [],
        (err, courses) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not retrieve courses."
                });

            }


            res.json({
                success: true,
                courses: courses
            });

        }
    );

});



// ==========================================
// GET COURSE DETAILS - ADMIN ONLY
// ==========================================

app.get("/api/admin/courses/:id", (req, res) => {

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }


    const courseId = req.params.id;


    db.get(
        `
        SELECT
            id,
            title,
            description,
            video_url
        FROM courses
        WHERE id = ?
        `,
        [courseId],

        (err, course) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not retrieve course."
                });

            }


            if (!course) {

                return res.status(404).json({
                    message:
                        "Course not found."
                });

            }


            res.json({

                success: true,

                course: course

            });

        }
    );

});

// ==========================================
// GET COURSE LESSONS - ADMIN ONLY
// ==========================================

app.get(
    "/api/admin/courses/:id/lessons",
    (req, res) => {

        if (
            !req.session.userId ||
            req.session.role !== "admin"
        ) {

            return res.status(403).json({
                message: "Admin access required."
            });

        }


        const courseId =
            req.params.id;


        db.all(
            `
            SELECT
                id,
                course_id,
                title,
                description,
                video_url,
                lesson_order
            FROM lessons
            WHERE course_id = ?
            ORDER BY lesson_order ASC
            `,
            [courseId],

            (err, lessons) => {

                if (err) {

                    console.error(err);

                    return res.status(500).json({
                        message:
                            "Could not retrieve lessons."
                    });

                }


                res.json({

                    success: true,

                    lessons: lessons

                });

            }
        );

    }
);

// ==========================================
// GET LESSONS FOR A COURSE - ADMIN ONLY
// ==========================================

app.get("/api/admin/courses/:courseId/lessons", (req, res) => {

    // Make sure the person viewing lessons is an admin

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }


    const courseId = req.params.courseId;


    db.all(
        `
        SELECT
            id,
            course_id,
            title,
            video_url,
            lesson_order
        FROM lessons
        WHERE course_id = ?
        ORDER BY lesson_order ASC, id ASC
        `,
        [courseId],

        (err, lessons) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not retrieve lessons."
                });

            }


            res.json({

                success: true,

                lessons: lessons

            });

        }
    );

});

// ==========================================
// CREATE COURSE - ADMIN ONLY
// ==========================================

app.post("/api/admin/courses", (req, res) => {

    // Make sure the person creating the course
    // is an admin

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }


    const {
        title,
        description,
        video_url
    } = req.body;


    // Check required information

    if (!title || !description) {

        return res.status(400).json({
            message:
                "Course title and description are required."
        });

    }


    // Create the course

    db.run(
        `
        INSERT INTO courses
(title, description, video_url)
VALUES (?, ?, ?)
RETURNING id
        `,
        [
            title,
            description,
            video_url || null
        ],

        function (err) {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not create course."
                });

            }


            res.json({

                success: true,

                message:
                    "Course created successfully.",

                courseId:
                    this.lastID

            });

        }

    );

});

// ==========================================
// CREATE LESSON - ADMIN ONLY
// ==========================================

app.post("/api/admin/lessons", (req, res) => {

    // Make sure the person creating the lesson
    // is an admin

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }


    const {
        course_id,
        title,
        description,
        video_url,
        lesson_order
    } = req.body;


    // Check required information

    if (!course_id || !title) {

        return res.status(400).json({
            message:
                "Course and lesson title are required."
        });

    }


    // Create the lesson

    db.run(
        `
        INSERT INTO lessons
(
    course_id,
    title,
    description,
    video_url,
    lesson_order
)
VALUES (?, ?, ?, ?, ?)
RETURNING id
        `,
        [
            course_id,
            title,
            description || null,
            video_url || null,
            lesson_order || 0
        ],

        function (err) {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not create lesson."
                });

            }


            res.json({

                success: true,

                message:
                    "Lesson created successfully.",

                lessonId:
                    this.lastID

            });

        }

    );

});

// ==========================================
// EDIT LESSON
// ==========================================

app.put("/api/admin/lessons/:id", (req, res) => {

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {
        return res.status(403).json({
            message: "Admin access required."
        });
    }

    const lessonId = req.params.id;

    const {
        title,
        description,
        video_url,
        lesson_order
    } = req.body;

    if (!title) {
        return res.status(400).json({
            message: "Lesson title is required."
        });
    }

    db.run(
        `
        UPDATE lessons
        SET
            title = ?,
            description = ?,
            video_url = ?,
            lesson_order = ?
        WHERE id = ?
        `,
        [
            title,
            description || null,
            video_url || null,
            lesson_order || 0,
            lessonId
        ],
        function (err) {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message: "Could not update lesson."
                });

            }

            if (this.changes === 0) {

                return res.status(404).json({
                    message: "Lesson not found."
                });

            }

            res.json({
                success: true,
                message: "Lesson updated successfully."
            });

        }
    );

});

// ==========================================
// DELETE LESSON
// ==========================================

app.delete("/api/admin/lessons/:id", (req, res) => {

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {
        return res.status(403).json({
            message: "Admin access required."
        });
    }

    const lessonId = req.params.id;

    db.run(
        `
        DELETE FROM user_lesson_progress
        WHERE lesson_id = ?
        `,
        [lessonId],
        function (progressErr) {

            if (progressErr) {

                console.error(progressErr);

                return res.status(500).json({
                    message:
                        "Could not remove lesson progress."
                });

            }

            db.run(
                `
                DELETE FROM lessons
                WHERE id = ?
                `,
                [lessonId],
                function (lessonErr) {

                    if (lessonErr) {

                        console.error(lessonErr);

                        return res.status(500).json({
                            message:
                                "Could not delete lesson."
                        });

                    }

                    if (this.changes === 0) {

                        return res.status(404).json({
                            message:
                                "Lesson not found."
                        });

                    }

                    res.json({
                        success: true,
                        message:
                            "Lesson deleted successfully."
                    });

                }
            );

        }
    );

});

// ==========================================
// ASSIGN COURSE TO USER - ADMIN ONLY
// ==========================================

app.post("/api/admin/users/:id/courses", (req, res) => {

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }


    const userId =
        req.params.id;

    const courseId =
        req.body.courseId;


    if (!courseId) {

        return res.status(400).json({
            message: "Course is required."
        });

    }


    // Make sure the user exists and is a customer

    db.get(
        `
        SELECT id
        FROM users
        WHERE id = ?
        AND role = 'customer'
        `,
        [userId],

        (err, user) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not verify user."
                });

            }


            if (!user) {

                return res.status(404).json({
                    message:
                        "Customer not found."
                });

            }


            // Add the course

            db.run(
                `
                INSERT INTO user_courses
                (user_id, course_id, progress)
                VALUES (?, ?, 0)
                `,
                [userId, courseId],

                function (err) {

                    if (err) {

                        if (
                            err.message.includes(
                                "UNIQUE constraint failed"
                            )
                        ) {

                            return res.status(409).json({
                                message:
                                    "This course is already assigned to this customer."
                            });

                        }


                        console.error(err);

                        return res.status(500).json({
                            message:
                                "Could not assign course."
                        });

                    }


                    res.json({

                        success: true,

                        message:
                            "Course assigned successfully."

                    });

                }
            );

        }
    );

});

// ==========================================
// GET MY COURSES - CUSTOMER ONLY
// ==========================================

app.get("/api/customer/courses", (req, res) => {

    // Make sure the customer is logged in

    if (
        !req.session.userId ||
        req.session.role !== "customer"
    ) {

        return res.status(403).json({
            message: "Customer access required."
        });

    }


    // Get courses assigned to this customer

    db.all(
        `
        SELECT
            courses.id,
            courses.title,
            courses.description,
            courses.video_url,
            user_courses.progress
        FROM user_courses

        JOIN courses
            ON user_courses.course_id = courses.id

        WHERE user_courses.user_id = ?

        ORDER BY courses.title ASC
        `,
        [req.session.userId],

        (err, courses) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not retrieve your courses."
                });

            }


            res.json({

                success: true,

                courses: courses

            });

        }
    );

});

// ==========================================
// GET CUSTOMER'S ASSIGNED COURSE
// ==========================================

app.get("/api/customer/all-courses", (req, res) => {

    if (
        !req.session.userId ||
        req.session.role !== "customer"
    ) {

        return res.status(403).json({
            message: "Customer access required."
        });

    }


    db.all(
        `
        SELECT
            courses.id,
            courses.title,
            courses.description,
            courses.video_url,
            user_courses.progress

        FROM user_courses

        JOIN courses
            ON user_courses.course_id = courses.id

        WHERE user_courses.user_id = ?

        ORDER BY courses.title ASC
        `,
        [req.session.userId],

        (err, courses) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not retrieve assigned courses."
                });

            }


            res.json({

                success: true,

                courses: courses

            });

        }

    );

});

// ==========================================
// GET CUSTOMER COURSE DETAILS
// ==========================================

app.get("/api/customer/courses/:id", (req, res) => {

    if (
        !req.session.userId ||
        req.session.role !== "customer"
    ) {

        return res.status(403).json({
            message: "Customer access required."
        });

    }


    const courseId =
        req.params.id;


    db.get(
        `
        SELECT
            courses.id,
            courses.title,
            courses.description,
            courses.video_url,
            user_courses.progress

        FROM user_courses

        JOIN courses
            ON user_courses.course_id = courses.id

        WHERE
            user_courses.user_id = ?
            AND user_courses.course_id = ?
        `,
        [
            req.session.userId,
            courseId
        ],

        (err, course) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not retrieve course."
                });

            }


            if (!course) {

                return res.status(404).json({
                    message:
                        "This course is not assigned to you."
                });

            }


            res.json({

                success: true,

                course: course

            });

        }

    );

});


// ==========================================
// GET CUSTOMER COURSE LESSONS
// ==========================================

app.get(
    "/api/customer/courses/:id/lessons",
    (req, res) => {

        if (
            !req.session.userId ||
            req.session.role !== "customer"
        ) {

            return res.status(403).json({
                message:
                    "Customer access required."
            });

        }


        const courseId =
            req.params.id;


        // First check that the customer
        // actually owns this course

        db.get(
            `
            SELECT 1
            FROM user_courses
            WHERE
                user_id = ?
                AND course_id = ?
            `,
            [
                req.session.userId,
                courseId
            ],

            (err, assignment) => {

                if (err) {

                    console.error(err);

                    return res.status(500).json({
                        message:
                            "Could not verify course access."
                    });

                }


                if (!assignment) {

                    return res.status(403).json({
                        message:
                            "You do not have access to this course."
                    });

                }


                // Get the lessons

                db.all(
                    `
                    SELECT
    lessons.id,
    lessons.course_id,
    lessons.title,
    lessons.description,
    lessons.video_url,
    lessons.lesson_order,

    COALESCE(
        user_lesson_progress.completed,
        0
    ) AS completed

FROM lessons

LEFT JOIN user_lesson_progress
    ON lessons.id = user_lesson_progress.lesson_id
    AND user_lesson_progress.user_id = ?

WHERE lessons.course_id = ?

ORDER BY
    lessons.lesson_order ASC,
    lessons.id ASC
                    `,
                    [
    req.session.userId,
    courseId
],

                    (err, lessons) => {

                        if (err) {

                            console.error(err);

                            return res.status(500).json({
                                message:
                                    "Could not retrieve lessons."
                            });

                        }


                        res.json({

                            success: true,

                            lessons: lessons

                        });

                    }

                );

            }

        );

    }
);

// ==========================================
// MARK LESSON AS COMPLETE - CUSTOMER
// ==========================================

app.post(
    "/api/customer/lessons/:lessonId/complete",
    (req, res) => {

        if (
            !req.session.userId ||
            req.session.role !== "customer"
        ) {

            return res.status(403).json({
                message: "Customer access required."
            });

        }


        const userId =
            req.session.userId;

        const lessonId =
            req.params.lessonId;


        // Find the lesson and its course

        db.get(
            `
            SELECT
                lessons.id,
                lessons.course_id

            FROM lessons

            WHERE lessons.id = ?
            `,
            [lessonId],

            (err, lesson) => {

                if (err) {

                    console.error(err);

                    return res.status(500).json({
                        message:
                            "Could not find lesson."
                    });

                }


                if (!lesson) {

                    return res.status(404).json({
                        message:
                            "Lesson not found."
                    });

                }


                // Check the customer has access
                // to this course

                db.get(
                    `
                    SELECT 1

                    FROM user_courses

                    WHERE
                        user_id = ?
                        AND course_id = ?
                    `,
                    [
                        userId,
                        lesson.course_id
                    ],

                    (err, assignment) => {

                        if (err) {

                            console.error(err);

                            return res.status(500).json({
                                message:
                                    "Could not verify course access."
                            });

                        }


                        if (!assignment) {

                            return res.status(403).json({
                                message:
                                    "You do not have access to this course."
                            });

                        }


                        // Save completed lesson

                        db.run(
                            `
                            INSERT INTO user_lesson_progress
                            (
                                user_id,
                                lesson_id,
                                completed
                            )

                            VALUES (?, ?, 1)

                            ON CONFLICT(user_id, lesson_id)

                            DO UPDATE SET completed = 1
                            `,
                            [
                                userId,
                                lessonId
                            ],

                            function (err) {

                                if (err) {

                                    console.error(err);

                                    return res.status(500).json({
                                        message:
                                            "Could not save lesson progress."
                                    });

                                }


                                // Count all lessons
                                // in this course

                                db.get(
                                    `
                                    SELECT
                                        COUNT(*) AS totalLessons

                                    FROM lessons

                                    WHERE course_id = ?
                                    `,
                                    [lesson.course_id],

                                    (err, totals) => {

                                        if (err) {

                                            console.error(err);

                                            return res.status(500).json({
                                                message:
                                                    "Could not calculate progress."
                                            });

                                        }


                                        // Count completed lessons

                                        db.get(
                                            `
                                            SELECT
                                                COUNT(*) AS completedLessons

                                            FROM user_lesson_progress

                                            JOIN lessons
                                                ON user_lesson_progress.lesson_id = lessons.id

                                            WHERE
                                                user_lesson_progress.user_id = ?
                                                AND lessons.course_id = ?
                                                AND user_lesson_progress.completed = 1
                                            `,
                                            [
                                                userId,
                                                lesson.course_id
                                            ],

                                            (err, completed) => {

                                                if (err) {

                                                    console.error(err);

                                                    return res.status(500).json({
                                                        message:
                                                            "Could not calculate completed lessons."
                                                    });

                                                }


                                                const totalLessons =
                                                    totals.totalLessons;

                                                const completedLessons =
                                                    completed.completedLessons;


                                                let progress = 0;

                                                if (totalLessons > 0) {

                                                    progress =
                                                        Math.round(
                                                            (
                                                                completedLessons /
                                                                totalLessons
                                                            ) * 100
                                                        );

                                                }


                                                // Update overall
                                                // course progress

                                                db.run(
                                                    `
                                                    UPDATE user_courses

                                                    SET progress = ?

                                                    WHERE
                                                        user_id = ?
                                                        AND course_id = ?
                                                    `,
                                                    [
                                                        progress,
                                                        userId,
                                                        lesson.course_id
                                                    ],

                                                    (err) => {

                                                        if (err) {

                                                            console.error(err);

                                                            return res.status(500).json({
                                                                message:
                                                                    "Could not update course progress."
                                                            });

                                                        }


                                                        res.json({

                                                            success: true,

                                                            progress: progress,

                                                            completedLessons:
                                                                completedLessons,

                                                            totalLessons:
                                                                totalLessons

                                                        });

                                                    }
                                                );

                                            }
                                        );

                                    }
                                );

                            }
                        );

                    }
                );

            }
        );

    }
);

// ==========================================
// CUSTOMER PAYMENT DETAILS
// ==========================================

app.get("/api/customer/payments", (req, res) => {

    if (!req.session.userId) {
        return res.status(401).json({
            message: "Not logged in."
        });
    }

    const userId = req.session.userId;

    db.all(
        `
        SELECT
            c.id AS course_id,
            c.title AS course_title,

            COALESCE(cp.total_fee, 0) AS total_fee,
            COALESCE(cp.amount_paid, 0) AS amount_paid

        FROM user_courses uc

        JOIN courses c
            ON c.id = uc.course_id

        LEFT JOIN course_payments cp
            ON cp.user_id = uc.user_id
            AND cp.course_id = uc.course_id

        WHERE uc.user_id = ?

        ORDER BY c.id
        `,
        [userId],
        (err, rows) => {

            if (err) {

                console.error(
                    "Customer payment error:",
                    err
                );

                return res.status(500).json({
                    message:
                        "Could not load payment details."
                });

            }

            const payments = rows.map(payment => {

                const totalFee =
                    Number(payment.total_fee) || 0;

                const amountPaid =
                    Number(payment.amount_paid) || 0;

                const remaining =
                    Math.max(
                        totalFee - amountPaid,
                        0
                    );

                let percentage = 0;

                if (totalFee > 0) {

                    percentage =
                        Math.min(
                            Math.round(
                                (amountPaid / totalFee) * 100
                            ),
                            100
                        );

                }

                return {
                    course_id:
                        payment.course_id,

                    course_title:
                        payment.course_title,

                    total_fee:
                        totalFee,

                    amount_paid:
                        amountPaid,

                    remaining:
                        remaining,

                    percentage:
                        percentage
                };

            });

            res.json({
                payments
            });

        }
    );

});

// ==========================================
// REQUEST PASSWORD CHANGE - CUSTOMER
// ==========================================

app.post("/api/customer/password-request", (req, res) => {

    // Make sure the customer is logged in

    if (
        !req.session.userId ||
        req.session.role !== "customer"
    ) {

        return res.status(403).json({
            message: "Customer access required."
        });

    }


    const userId =
        req.session.userId;


    // Check if there is already a pending request

    db.get(
        `
        SELECT id
        FROM password_requests
        WHERE user_id = ?
        AND status = 'pending'
        `,
        [userId],

        (err, request) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not check password requests."
                });

            }


            // Don't create duplicate requests

            if (request) {

                return res.status(409).json({
                    message:
                        "You already have a pending password change request."
                });

            }


            // Create the request

            db.run(
                `
                INSERT INTO password_requests
                (user_id, status)
                VALUES (?, 'pending')
                `,
                [userId],

                function (err) {

                    if (err) {

                        console.error(err);

                        return res.status(500).json({
                            message:
                                "Could not submit password request."
                        });

                    }


                    res.json({

                        success: true,

                        message:
                            "Your password change request has been sent to the admin."

                    });

                }
            );

        }
    );

});

// ==========================================
// REQUEST PASSWORD RESET - CUSTOMER
// ==========================================

app.post(
    "/api/customer/request-password-reset",
    (req, res) => {

        // Make sure a customer is logged in

        if (
            !req.session.userId ||
            req.session.role !== "customer"
        ) {

            return res.status(403).json({
                message: "Customer access required."
            });

        }


        const userId =
            req.session.userId;


        const message =
            req.body.message || "";


        // Check if the customer already has
        // a pending request

        db.get(
            `
            SELECT id
            FROM password_requests
            WHERE
                user_id = ?
                AND status = 'pending'
            `,
            [userId],

            (err, existingRequest) => {

                if (err) {

                    console.error(err);

                    return res.status(500).json({
                        message:
                            "Could not check password requests."
                    });

                }


                if (existingRequest) {

                    return res.status(409).json({
                        message:
                            "You already have a pending password request."
                    });

                }


                // Create password reset request

                db.run(
                    `
                    INSERT INTO password_requests
(
    user_id,
    message,
    status,
    created_at
)
VALUES (?, ?, 'pending', ?)
                    `,
                    [
                        userId,
                        message,
                        new Date().toISOString()
                    ],

                    function (err) {

                        if (err) {

                            console.error(err);

                            return res.status(500).json({
                                message:
                                    "Could not send password request."
                            });

                        }


                        res.json({

                            success: true,

                            message:
                                "Your password request has been sent to the administrator."

                        });

                    }

                );

            }

        );

    }
);

// ==========================================
// FORGOT PASSWORD - PUBLIC
// ==========================================

app.post("/api/forgot-password", (req, res) => {

    const username =
        req.body.username
            ?.trim();


    if (!username) {

        return res.status(400).json({
            message:
                "Please enter your username."
        });

    }


    // Find the customer

    db.get(
        `
        SELECT id, username
        FROM users
        WHERE username = ?
        AND role = 'customer'
        `,
        [username],

        (err, user) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not process password request."
                });

            }


            if (!user) {

                return res.status(404).json({
                    message:
                        "No customer account was found with that username."
                });

            }


            // Check for an existing pending request

            db.get(
                `
                SELECT id
                FROM password_requests
                WHERE user_id = ?
                AND status = 'pending'
                `,
                [user.id],

                (err, existingRequest) => {

                    if (err) {

                        console.error(err);

                        return res.status(500).json({
                            message:
                                "Could not check password requests."
                        });

                    }


                    if (existingRequest) {

                        return res.status(409).json({
                            message:
                                "A password request is already pending for this account."
                        });

                    }


                    // Create the request

                    db.run(
                        `
                        INSERT INTO password_requests
                        (
                            user_id,
                            message,
                            status,
                            created_at
                        )
                        VALUES (?, ?, 'pending', ?)
                        `,
                        [
                            user.id,
                            "Password reset requested from login page.",
                            new Date().toISOString()
                        ],

                        function (err) {

                            if (err) {

                                console.error(err);

                                return res.status(500).json({
                                    message:
                                        "Could not send password request."
                                });

                            }


                            res.json({

                                success: true,

                                message:
                                    "Your password request has been sent to the administrator."

                            });

                        }
                    );

                }
            );

        }
    );

});

// ==========================================
// GET REVIEWS - ADMIN ONLY
// ==========================================

app.get("/api/admin/reviews", (req, res) => {

    // Make sure the person viewing reviews is an admin

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }


    // Get all reviews with customer information

    db.all(
        `
        SELECT
            reviews.id,
            reviews.user_id,
            reviews.rating,
            reviews.review,
            reviews.status,
            reviews.created_at,

            users.username,
            users.name,
            users.email

        FROM reviews

        JOIN users
            ON reviews.user_id = users.id

        ORDER BY
            reviews.created_at DESC
        `,

        [],

        (err, reviews) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not retrieve reviews."
                });

            }


            res.json({

                success: true,

                reviews: reviews

            });

        }
    );

});

// ==========================================
// UPDATE REVIEW STATUS - ADMIN ONLY
// ==========================================

app.put("/api/admin/reviews/:id/status", (req, res) => {

    // Make sure the person is an admin

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }


    const reviewId = req.params.id;
    const { status } = req.body;


    // Only allow these two statuses

    if (
        status !== "approved" &&
        status !== "rejected"
    ) {

        return res.status(400).json({
            message: "Invalid review status."
        });

    }


    // Update the review

    db.run(
        `
        UPDATE reviews

        SET status = ?

        WHERE id = ?
        `,

        [status, reviewId],

        function (err) {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not update review."
                });

            }


            if (this.changes === 0) {

                return res.status(404).json({
                    message:
                        "Review not found."
                });

            }


            res.json({

                success: true,

                message:
                    `Review ${status} successfully.`

            });

        }
    );

});

// ==========================================
// GET PASSWORD REQUESTS - ADMIN ONLY
// ==========================================

app.get("/api/admin/password-requests", (req, res) => {

    if (
        !req.session.userId ||
        req.session.role !== "admin"
    ) {

        return res.status(403).json({
            message: "Admin access required."
        });

    }

    db.all(
        `
        SELECT
            password_requests.id,
            password_requests.user_id,
            password_requests.message,
            password_requests.status,
            password_requests.created_at,
            users.username

        FROM password_requests

        JOIN users
            ON password_requests.user_id = users.id

        WHERE password_requests.status = 'pending'

        ORDER BY password_requests.created_at DESC
        `,
        [],

        (err, requests) => {

            if (err) {

                console.error(err);

                return res.status(500).json({
                    message:
                        "Could not retrieve password requests."
                });

            }

            res.json({

                success: true,

                requests: requests

            });

        }
    );

});


// ==========================================
// RESET CUSTOMER PASSWORD - ADMIN ONLY
// ==========================================

app.post(
    "/api/admin/password-requests/:id/reset",
    async (req, res) => {

        if (
            !req.session.userId ||
            req.session.role !== "admin"
        ) {

            return res.status(403).json({
                message: "Admin access required."
            });

        }


        const requestId =
            req.params.id;

        const newPassword =
            req.body.password;


        if (!newPassword) {

            return res.status(400).json({
                message:
                    "A new password is required."
            });

        }


        if (newPassword.length < 6) {

            return res.status(400).json({
                message:
                    "Password must be at least 6 characters."
            });

        }


        // Find the password request

        db.get(
            `
            SELECT
                id,
                user_id,
                status

            FROM password_requests

            WHERE id = ?
            `,
            [requestId],

            async (err, request) => {

                if (err) {

                    console.error(err);

                    return res.status(500).json({
                        message:
                            "Could not find password request."
                    });

                }


                if (!request) {

                    return res.status(404).json({
                        message:
                            "Password request not found."
                    });

                }


                if (request.status !== "pending") {

                    return res.status(400).json({
                        message:
                            "This password request has already been handled."
                    });

                }


                try {

                    // Hash the new password

                    const hashedPassword =
                        await bcrypt.hash(
                            newPassword,
                            10
                        );


                    // Update customer password

                    db.run(
                        `
                        UPDATE users

                        SET password = ?

                        WHERE id = ?
                        `,
                        [
                            hashedPassword,
                            request.user_id
                        ],

                        function (err) {

                            if (err) {

                                console.error(err);

                                return res.status(500).json({
                                    message:
                                        "Could not update password."
                                });

                            }


                            // Mark request as resolved

                            db.run(
                                `
                                UPDATE password_requests

                                SET status = 'resolved'

                                WHERE id = ?
                                `,
                                [requestId],

                                function (err) {

                                    if (err) {

                                        console.error(err);

                                        return res.status(500).json({
                                            message:
                                                "Password changed, but request could not be marked as resolved."
                                        });

                                    }


                                    res.json({

                                        success: true,

                                        message:
                                            "Customer password has been reset successfully."

                                    });

                                }

                            );

                        }

                    );

                } catch (error) {

                    console.error(error);

                    return res.status(500).json({
                        message:
                            "Could not reset password."
                    });

                }

            }

        );

    }
);


// ==========================================
// DISMISS PASSWORD REQUEST - ADMIN ONLY
// ==========================================

app.post(
    "/api/admin/password-requests/:id/dismiss",
    (req, res) => {

        if (
            !req.session.userId ||
            req.session.role !== "admin"
        ) {

            return res.status(403).json({
                message: "Admin access required."
            });

        }


        const requestId =
            req.params.id;


        db.run(
            `
            UPDATE password_requests

            SET status = 'dismissed'

            WHERE id = ?
            `,
            [requestId],

            function (err) {

                if (err) {

                    console.error(err);

                    return res.status(500).json({
                        message:
                            "Could not dismiss password request."
                    });

                }


                if (this.changes === 0) {

                    return res.status(404).json({
                        message:
                            "Password request not found."
                    });

                }


                res.json({

                    success: true,

                    message:
                        "Password request dismissed."

                });

            }

        );

    }
);



// ==========================================
// LOGOUT
// ==========================================

app.post("/api/logout", (req, res) => {

    req.session.destroy((err) => {

        if (err) {

            return res.status(500).json({

                message:
                    "Could not log out."

            });

        }


        res.json({

            success: true

        });

    });

});


// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Website running on port ${PORT}`
    );
});

module.exports = db;