const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
const PORT = 3000;


// ==========================================
// DATABASE
// ==========================================

const db = new sqlite3.Database("./database.db", (err) => {

    if (err) {
        console.error("Database error:", err);
    } else {
        console.log("Connected to database.");
    }

});


// ==========================================
// CREATE DATABASE TABLES
// ==========================================

db.serialize(() => {

    db.run(`
       CREATE TABLE IF NOT EXISTS users (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    username TEXT UNIQUE NOT NULL,

    password TEXT NOT NULL,

    role TEXT NOT NULL DEFAULT 'customer',

    package TEXT DEFAULT NULL,

    active INTEGER NOT NULL DEFAULT 1
    )
    `);

 // ==========================================
// PASSWORD REQUESTS TABLE
// ==========================================

db.run(`
    CREATE TABLE IF NOT EXISTS password_requests (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        user_id INTEGER NOT NULL,

        message TEXT,

        status TEXT NOT NULL DEFAULT 'pending',

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (user_id)
            REFERENCES users(id)
            ON DELETE CASCADE

    )
`);

// ==========================================
// UPDATE PASSWORD REQUESTS TABLE
// ==========================================

db.all(
    `PRAGMA table_info(password_requests)`,
    (err, columns) => {

        if (err) {
            console.error(
                "Could not inspect password_requests table:",
                err
            );
            return;
        }

        const columnNames =
            columns.map(column => column.name);


        // ------------------------------------------
        // ADD MESSAGE COLUMN IF MISSING
        // ------------------------------------------

        if (!columnNames.includes("message")) {

            db.run(
                `
                ALTER TABLE password_requests
                ADD COLUMN message TEXT
                `,
                (err) => {

                    if (err) {

                        console.error(
                            "Could not add message column:",
                            err
                        );

                    } else {

                        console.log(
                            "Added message column to password_requests."
                        );

                    }

                }
            );

        }


        // ------------------------------------------
        // ADD CREATED_AT COLUMN IF MISSING
        // ------------------------------------------

        if (!columnNames.includes("created_at")) {

            db.run(
                `
                ALTER TABLE password_requests
                ADD COLUMN created_at TEXT
                `,
                (err) => {

                    if (err) {

                        console.error(
                            "Could not add created_at column:",
                            err
                        );

                        return;
                    }


                    console.log(
                        "Added created_at column to password_requests."
                    );


                    // Give existing requests a timestamp
                    db.run(
                        `
                        UPDATE password_requests
                        SET created_at = ?
                        WHERE created_at IS NULL
                        `,
                        [new Date().toISOString()],
                        (err) => {

                            if (err) {

                                console.error(
                                    "Could not set existing created_at values:",
                                    err
                                );

                            } else {

                                console.log(
                                    "Updated existing password request timestamps."
                                );

                            }

                        }
                    );

                }
            );

        }

    }
);

    db.run(`
        CREATE TABLE IF NOT EXISTS courses (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            title TEXT NOT NULL,

            description TEXT,

            video_url TEXT

        )
    `);

    db.run(`
    ALTER TABLE users
    ADD COLUMN package TEXT DEFAULT NULL
`, (err) => {

    if (err && !err.message.includes("duplicate column name")) {
        console.error("Could not add package column:", err);
    }

});

    db.run(`
        CREATE TABLE IF NOT EXISTS user_courses (

            user_id INTEGER NOT NULL,

            course_id INTEGER NOT NULL,

            progress INTEGER DEFAULT 0,

            PRIMARY KEY (user_id, course_id)

        )
    `);

   // ==========================================
// LESSONS TABLE
// ==========================================

db.run(`
    CREATE TABLE IF NOT EXISTS lessons (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        course_id INTEGER NOT NULL,

        title TEXT NOT NULL,

        description TEXT,

        video_url TEXT,

        lesson_order INTEGER DEFAULT 0,

        FOREIGN KEY (course_id)
            REFERENCES courses(id)
            ON DELETE CASCADE

    )
`);


// ==========================================
// USER LESSON PROGRESS TABLE
// ==========================================

db.run(`
    CREATE TABLE IF NOT EXISTS user_lesson_progress (

        user_id INTEGER NOT NULL,

        lesson_id INTEGER NOT NULL,

        completed INTEGER NOT NULL DEFAULT 0,

        PRIMARY KEY (user_id, lesson_id),

        FOREIGN KEY (user_id)
            REFERENCES users(id)
            ON DELETE CASCADE,

        FOREIGN KEY (lesson_id)
            REFERENCES lessons(id)
            ON DELETE CASCADE

    )
`);


});


// ==========================================
// MIDDLEWARE
// ==========================================

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));


// ==========================================
// LOGIN SESSIONS
// ==========================================

app.use(
    session({

        secret: "CHANGE_THIS_LATER_TO_A_RANDOM_SECRET",

        resave: false,

        saveUninitialized: false,

        cookie: {

            httpOnly: true,

            secure: false,

            maxAge: 1000 * 60 * 60 * 24

        }

    })
);


// ==========================================
// WEBSITE FILES
// ==========================================

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);


// ==========================================
// LOGIN
// ==========================================

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
        username,
        password,
        package: customerPackage
    } = req.body;


    // Check required information

    if (!username || !password) {

        return res.status(400).json({
            message: "Username and password are required."
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
            (username, password, role, package, active)
            VALUES (?, ?, 'customer', ?, 1)
            `,
            [
                username,
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
        (course_id, title, video_url, lesson_order)
        VALUES (?, ?, ?, ?)
        `,
        [
            course_id,
            title,
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