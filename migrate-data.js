require("dotenv").config();

const sqlite3 = require("sqlite3").verbose();
const { Client } = require("pg");

const sqlite = new sqlite3.Database("./database.db");

const pg = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        sqlite.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function migrate() {
    try {
        await pg.connect();

        console.log("Connected to Neon PostgreSQL.");
        console.log("Beginning migration...");

        await pg.query("BEGIN");

        /*
         * Users
         */
        const users = await all(`
            SELECT
                id,
                username,
                password,
                role,
                active,
                package,
                name,
                email
            FROM users
            ORDER BY id
        `);

        for (const user of users) {
            await pg.query(`
                INSERT INTO users
                    (id, username, password, role, active, package, name, email)
                VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO NOTHING
            `, [
                user.id,
                user.username,
                user.password,
                user.role,
                user.active,
                user.package,
                user.name,
                user.email
            ]);
        }

        console.log(`Users migrated: ${users.length}`);

        /*
         * Courses
         */
        const courses = await all(`
            SELECT
                id,
                title,
                description,
                video_url
            FROM courses
            ORDER BY id
        `);

        for (const course of courses) {
            await pg.query(`
                INSERT INTO courses
                    (id, title, description, video_url)
                VALUES
                    ($1, $2, $3, $4)
                ON CONFLICT (id) DO NOTHING
            `, [
                course.id,
                course.title,
                course.description,
                course.video_url
            ]);
        }

        console.log(`Courses migrated: ${courses.length}`);

        /*
         * Lessons
         */
        const lessons = await all(`
            SELECT
                id,
                course_id,
                title,
                description,
                video_url,
                lesson_order
            FROM lessons
            ORDER BY id
        `);

        for (const lesson of lessons) {
            await pg.query(`
                INSERT INTO lessons
                    (id, course_id, title, description, video_url, lesson_order)
                VALUES
                    ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (id) DO NOTHING
            `, [
                lesson.id,
                lesson.course_id,
                lesson.title,
                lesson.description,
                lesson.video_url,
                lesson.lesson_order
            ]);
        }

        console.log(`Lessons migrated: ${lessons.length}`);

        /*
         * User courses
         */
        const userCourses = await all(`
            SELECT
                user_id,
                course_id,
                progress
            FROM user_courses
            ORDER BY user_id, course_id
        `);

        for (const row of userCourses) {
            await pg.query(`
                INSERT INTO user_courses
                    (user_id, course_id, progress)
                VALUES
                    ($1, $2, $3)
                ON CONFLICT (user_id, course_id) DO NOTHING
            `, [
                row.user_id,
                row.course_id,
                row.progress
            ]);
        }

        console.log(`User courses migrated: ${userCourses.length}`);

        /*
         * Lesson progress
         */
        const lessonProgress = await all(`
            SELECT
                user_id,
                lesson_id,
                completed
            FROM user_lesson_progress
            ORDER BY user_id, lesson_id
        `);

        for (const row of lessonProgress) {
            await pg.query(`
                INSERT INTO user_lesson_progress
                    (user_id, lesson_id, completed)
                VALUES
                    ($1, $2, $3)
                ON CONFLICT (user_id, lesson_id) DO NOTHING
            `, [
                row.user_id,
                row.lesson_id,
                row.completed
            ]);
        }

        console.log(`Lesson progress migrated: ${lessonProgress.length}`);

        /*
         * Course payments
         */
        const payments = await all(`
            SELECT
                id,
                user_id,
                course_id,
                total_fee,
                amount_paid
            FROM course_payments
            ORDER BY id
        `);

        for (const payment of payments) {
            await pg.query(`
                INSERT INTO course_payments
                    (id, user_id, course_id, total_fee, amount_paid)
                VALUES
                    ($1, $2, $3, $4, $5)
                ON CONFLICT (id) DO NOTHING
            `, [
                payment.id,
                payment.user_id,
                payment.course_id,
                payment.total_fee,
                payment.amount_paid
            ]);
        }

        console.log(`Course payments migrated: ${payments.length}`);

        /*
         * Enrollment requests
         */
        const enrollmentRequests = await all(`
            SELECT
                id,
                user_id,
                course_id,
                status,
                created_at
            FROM enrollment_requests
            ORDER BY id
        `);

        for (const row of enrollmentRequests) {
            await pg.query(`
                INSERT INTO enrollment_requests
                    (id, user_id, course_id, status, created_at)
                VALUES
                    ($1, $2, $3, $4, $5)
                ON CONFLICT (id) DO NOTHING
            `, [
                row.id,
                row.user_id,
                row.course_id,
                row.status,
                row.created_at
            ]);
        }

        console.log(`Enrollment requests migrated: ${enrollmentRequests.length}`);

        /*
         * Password requests
         */
        const passwordRequests = await all(`
            SELECT
                id,
                user_id,
                status,
                requested_at,
                message,
                created_at
            FROM password_requests
            ORDER BY id
        `);

        for (const row of passwordRequests) {
            await pg.query(`
                INSERT INTO password_requests
                    (id, user_id, status, requested_at, message, created_at)
                VALUES
                    ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (id) DO NOTHING
            `, [
                row.id,
                row.user_id,
                row.status,
                row.requested_at,
                row.message,
                row.created_at
            ]);
        }

        console.log(`Password requests migrated: ${passwordRequests.length}`);

               /*
         * Reviews
         */
        const reviews = await all(`
            SELECT
                id,
                user_id,
                rating,
                review,
                status,
                created_at
            FROM reviews
            ORDER BY id
        `);

        let normalReviewsMigrated = 0;
        let orphanedReviewsMigrated = 0;

        for (const review of reviews) {

            // Check whether the review belongs to a user
            // that actually exists in the users table.
            const userExists = await pg.query(`
                SELECT id
                FROM users
                WHERE id = $1
            `, [review.user_id]);

            if (userExists.rows.length === 0) {

                // Preserve orphaned reviews separately instead
                // of violating the reviews -> users foreign key.
                await pg.query(`
                    INSERT INTO orphaned_reviews
                        (id, original_user_id, rating, review, status, created_at)
                    VALUES
                        ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    review.id,
                    review.user_id,
                    review.rating,
                    review.review,
                    review.status,
                    review.created_at
                ]);

                orphanedReviewsMigrated++;

            } else {

                // Normal review belonging to an existing user.
                await pg.query(`
                    INSERT INTO reviews
                        (id, user_id, rating, review, status, created_at)
                    VALUES
                        ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    review.id,
                    review.user_id,
                    review.rating,
                    review.review,
                    review.status,
                    review.created_at
                ]);

                normalReviewsMigrated++;
            }
        }

        console.log(`Reviews migrated: ${normalReviewsMigrated}`);
        console.log(`Orphaned reviews archived: ${orphanedReviewsMigrated}`);
        /*
         * Reset identity sequences after preserving SQLite IDs.
         * This makes sure future INSERTs receive new IDs.
         */
        await pg.query(`
            SELECT setval(
                pg_get_serial_sequence('users', 'id'),
                COALESCE((SELECT MAX(id) FROM users), 1),
                true
            );

            SELECT setval(
                pg_get_serial_sequence('courses', 'id'),
                COALESCE((SELECT MAX(id) FROM courses), 1),
                true
            );

            SELECT setval(
                pg_get_serial_sequence('lessons', 'id'),
                COALESCE((SELECT MAX(id) FROM lessons), 1),
                true
            );

            SELECT setval(
                pg_get_serial_sequence('course_payments', 'id'),
                COALESCE((SELECT MAX(id) FROM course_payments), 1),
                true
            );

            SELECT setval(
                pg_get_serial_sequence('enrollment_requests', 'id'),
                COALESCE((SELECT MAX(id) FROM enrollment_requests), 1),
                true
            );

            SELECT setval(
                pg_get_serial_sequence('password_requests', 'id'),
                COALESCE((SELECT MAX(id) FROM password_requests), 1),
                true
            );

            SELECT setval(
                pg_get_serial_sequence('reviews', 'id'),
                COALESCE((SELECT MAX(id) FROM reviews), 1),
                true
            );
        `);

        /*
         * Commit everything only after every table succeeds.
         */
        await pg.query("COMMIT");

        console.log("");
        console.log("======================================");
        console.log("MIGRATION COMPLETED SUCCESSFULLY");
        console.log("======================================");

    } catch (error) {
        console.error("");
        console.error("Migration failed:");
        console.error(error.message);

        try {
            await pg.query("ROLLBACK");
            console.log("PostgreSQL migration rolled back.");
        } catch (rollbackError) {
            console.error("Rollback failed:", rollbackError.message);
        }

    } finally {
        sqlite.close();
        await pg.end();
    }
}

migrate();