
const express = require("express");
const cors = require("cors");
const db = require("./db");
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.post("/api/farm-setup", (req, res) => {
    const { name, email, password, phone, area_name, area_acres, location } = req.body;

    if (
        !name || !email || !password ||
        !area_name || area_acres == null ||
        !location || Number(area_acres) <= 0 ||
        !Number.isFinite(Number(area_acres))
    ) {
        return res.status(400).json({
            error: "Please provide valid farmer and farming area details."
        });
    }

    const farmerSql = `
        INSERT INTO farmers (name, email, password, phone)
        VALUES (?, ?, ?, ?)
    `;

    db.query(
        farmerSql,
        [name.trim(), email.trim(), password, phone || null],
        (err, farmerResult) => {
            if (err) {
                if (err.code === "ER_DUP_ENTRY") {
                    return res.status(409).json({
                        error: "This email is already registered."
                    });
                }

                return res.status(500).json({
                    error: "Could not create farmer."
                });
            }

            const farmerId = farmerResult.insertId;

            const areaSql = `
                INSERT INTO farming_areas
                (farmer_id, area_name, area_acres, location)
                VALUES (?, ?, ?, ?)
            `;

            db.query(
                areaSql,
                [farmerId, area_name.trim(), Number(area_acres), location.trim()],
                (areaErr, areaResult) => {
                    if (areaErr) {
                        return db.query(
                            "DELETE FROM farmers WHERE farmer_id = ?",
                            [farmerId],
                            () => res.status(500).json({
                                error: "Could not save farming area."
                            })
                        );
                    }

                    res.status(201).json({
                        message: "Farm setup completed successfully!",
                        farmer_id: farmerId,
                        area_id: areaResult.insertId
                    });
                }
            );
        }
    );
});

app.post("/api/farmer-crops", async (req, res) => {
    console.log("ADD CROP REQUEST RECEIVED");

    const {
        farmer_id,
        area_id,
        crop_id,
        crop_area_acres,
        sowing_date
    } = req.body;

    if (
        !Number.isInteger(Number(farmer_id)) ||
        Number(farmer_id) <= 0 ||
        !Number.isInteger(Number(area_id)) ||
        Number(area_id) <= 0 ||
        !Number.isInteger(Number(crop_id)) ||
        Number(crop_id) <= 0 ||
        crop_area_acres == null ||
        !Number.isFinite(Number(crop_area_acres)) ||
        Number(crop_area_acres) <= 0
    ) {
        return res.status(400).json({
            error: "Please provide valid crop details."
        });
    }

    try {
        const [areas] = await db.query(
            `SELECT area_acres
             FROM farming_areas
             WHERE area_id = ? AND farmer_id = ?`,
            [Number(area_id), Number(farmer_id)]
        );

        if (areas.length === 0) {
            return res.status(404).json({
                error: "Farming area not found for this farmer."
            });
        }

        if (Number(crop_area_acres) > Number(areas[0].area_acres)) {
            return res.status(400).json({
                error: "Crop area cannot exceed total farm area."
            });
        }

        const [crops] = await db.query(
            `SELECT crop_id, crop_name
             FROM crop_knowledge
             WHERE crop_id = ?`,
            [Number(crop_id)]
        );

        if (crops.length === 0) {
            return res.status(404).json({
                error: "Crop not found."
            });
        }

        const [result] = await db.query(
            `INSERT INTO farmer_crops
             (farmer_id, area_id, crop_id, crop_area_acres, sowing_date)
             VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_DATE))`,
            [
                Number(farmer_id),
                Number(area_id),
                Number(crop_id),
                Number(crop_area_acres),
                sowing_date || null
            ]
        );

        console.log("CROP SAVED SUCCESSFULLY:", result.insertId);

        return res.status(201).json({
            message: "Crop added successfully!",
            farmer_crop_id: result.insertId,
            crop_name: crops[0].crop_name
        });

    } catch (err) {
        console.error("Save crop database error:", err);

        return res.status(500).json({
            error: "Failed to save crop."
        });
    }
});

app.get("/", (req, res) => {
    res.send("Smart Agriculture Server is Running!");
});
console.log("CROPS ROUTE LOADED");
app.get("/api/crops", async (req, res) => {
    const sql = "SELECT * FROM crop_knowledge";

    try {
    const [results] = await db.query(sql);
    res.json(results);
} catch (err) {
    console.error("Failed to fetch crops:", err);
    res.status(500).json({
        error: "Failed to fetch crops"
    });
}
});

app.get("/api/my-crops/:farmerId", async (req, res) => {
    const farmerId = Number(req.params.farmerId);

    if (!Number.isInteger(farmerId) || farmerId <= 0) {
        return res.status(400).json({
            error: "Invalid farmer ID."
        });
    }

    const sql = `
        SELECT
            fc.farmer_crop_id,
            ck.crop_name,
            fc.crop_area_acres,
            fc.sowing_date,
            f.area_name,
            f.location,
            ck.water_requirement,
            ck.growth_duration_min,
            ck.growth_duration_max
        FROM farmer_crops fc
        JOIN crop_knowledge ck ON fc.crop_id = ck.crop_id
        JOIN farming_areas f ON fc.area_id = f.area_id
        WHERE fc.farmer_id = ?
        ORDER BY fc.sowing_date DESC
    `;

    try {
        console.log("My Crops API called for farmer:", farmerId);
       console.log("Starting My Crops database query");

const [results] = await db.query(sql, [farmerId]);

console.log("My Crops query completed");
console.log("Rows returned:", results.length);

res.json(results);
    } catch (err) {
        console.error("Failed to retrieve farmer crops:", err);
        res.status(500).json({
            error: "Failed to retrieve farmer crops."
        });
    }
});


app.get("/api/crop-growth/:farmerCropId", async (req, res) => {
    const farmerCropId = Number(req.params.farmerCropId);

    if (!Number.isInteger(farmerCropId) || farmerCropId <= 0) {
        return res.status(400).json({
            error: "Invalid farmer crop ID."
        });
    }

    try {
        const sql = `
            SELECT
                fc.farmer_crop_id,
                ck.crop_name,
                fc.sowing_date,
                cgs.stage_name,
                cgs.start_day,
                cgs.end_day,
                cgs.description
            FROM farmer_crops fc
            JOIN crop_knowledge ck
                ON fc.crop_id = ck.crop_id
            JOIN crop_growth_stages cgs
                ON ck.crop_id = cgs.crop_id
            WHERE fc.farmer_crop_id = ?
              AND DATEDIFF(CURRENT_DATE, DATE(fc.sowing_date))
                  BETWEEN cgs.start_day AND cgs.end_day
        `;

        const [results] = await db.query(sql, [farmerCropId]);

        const ageSql = `
            SELECT
                fc.farmer_crop_id,
                ck.crop_name,
                fc.sowing_date,
                DATEDIFF(CURRENT_DATE, DATE(fc.sowing_date))
                    AS crop_age_days
            FROM farmer_crops fc
            JOIN crop_knowledge ck
                ON fc.crop_id = ck.crop_id
            WHERE fc.farmer_crop_id = ?
        `;

        const [ageResults] = await db.query(ageSql, [farmerCropId]);

        if (ageResults.length === 0) {
            return res.status(404).json({
                error: "Crop record not found."
            });
        }

        const crop = ageResults[0];
        const age = crop.crop_age_days;

        if (results.length === 0) {
            return res.json({
                ...crop,
                growth_stage: age < 0
                    ? "Not yet sown"
                    : "Stage not defined for this crop age"
            });
        }

        res.json({
            ...results[0],
            crop_age_days: age,
            growth_stage: results[0].stage_name
        });

    } catch (err) {
        console.error("Failed to calculate crop growth:", err);

        res.status(500).json({
            error: "Failed to calculate crop growth."
        });
    }
});

console.log("TEST ROUTE CODE LOADED");
app.get("/api/test", (req, res) => {
    console.log("TEST ROUTE HIT");
    res.send("Test route works!");
});

app.get("/api/harvest-estimate/:farmerCropId", async (req, res) => {
    const farmerCropId = Number(req.params.farmerCropId);

    if (!Number.isInteger(farmerCropId) || farmerCropId <= 0) {
        return res.status(400).json({
            message: "Invalid farmer crop ID"
        });
    }

    const sql = `
        SELECT
            fc.farmer_crop_id,
            ck.crop_name,
            fc.sowing_date,
            ck.growth_duration_min,
            ck.growth_duration_max,
            DATE_ADD(
                DATE(fc.sowing_date),
                INTERVAL ck.growth_duration_min DAY
            ) AS earliest_harvest_date,
            DATE_ADD(
                DATE(fc.sowing_date),
                INTERVAL ck.growth_duration_max DAY
            ) AS latest_harvest_date
        FROM farmer_crops fc
        JOIN crop_knowledge ck
            ON fc.crop_id = ck.crop_id
        WHERE fc.farmer_crop_id = ?
    `;

    try {
        const [results] = await db.query(sql, [farmerCropId]);

        if (results.length === 0) {
            return res.status(404).json({
                message: "Crop not found"
            });
        }

        res.json(results[0]);

    } catch (err) {
        console.error("Harvest estimate error:", err);

        res.status(500).json({
            message: "Unable to calculate harvest estimate"
        });
    }
});


app.delete("/api/farmer-crops/:id", (req, res) => {
    const farmerCropId = Number(req.params.id);

    if (!Number.isInteger(farmerCropId) || farmerCropId <= 0) {
        return res.status(400).json({
            error: "Invalid crop ID."
        });
    }

    const sql = `
        DELETE FROM farmer_crops
        WHERE farmer_crop_id = ? AND farmer_id = ?
    `;

    db.query(sql, [farmerCropId, 1], (err, result) => {
        if (err) {
            console.error("Delete crop error:", err);
            return res.status(500).json({
                error: "Could not delete crop."
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "Crop not found."
            });
        }

        res.json({
            message: "Crop deleted successfully!"
        });
    });
});

app.get("/api/fertilizer-providers", async (req, res) => {
    try {
        const [providers] = await db.query(`
            SELECT
                p.provider_id,
                p.provider_name,
                p.shop_name,
                p.phone,
                p.email,
                p.address,
                f.fertilizer_id,
                f.fertilizer_name,
                f.fertilizer_type,
                f.stock_quantity,
                f.minimum_stock,
                f.unit,
                CASE
                    WHEN f.stock_quantity <= f.minimum_stock
                    THEN 'Low Stock'
                    ELSE 'Available'
                END AS stock_status
            FROM fertilizer_providers p
            LEFT JOIN fertilizers f
                ON p.provider_id = f.provider_id
            ORDER BY p.provider_id, f.fertilizer_name
        `);

        res.json(providers);
    } catch (error) {
        console.error("Fertilizer provider error:", error);
        res.status(500).json({
            message: "Unable to load fertilizer providers"
        });
    }
});
console.log(
    "MY-CROPS ROUTE:",
    app._router
        ? app._router.stack
            .filter(layer => layer.route)
            .map(layer => layer.route.path)
        : "Router inspection unavailable"
);
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
