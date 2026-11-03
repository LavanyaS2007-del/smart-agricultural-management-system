
const mysql = require("mysql2");

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "batch9@123",
    database: "smart_agriculture"
}).promise();

db.connect()
    .then(() => {
        console.log("MySQL Connected Successfully ✅");
    })
    .catch((err) => {
        console.log("MySQL Connection Failed ❌");
        console.log(err.message);
    });

module.exports = db;
