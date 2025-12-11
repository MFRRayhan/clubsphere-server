// index.js - Full ClubSphere Backend
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 5000;

// Firebase Admin SDK init
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middleware
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5174"],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(express.json());

// Verify firebase token
const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    // console.log("Decoded:", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    res.status(401).send({ message: "Unauthorized Access" });
  }
};

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.erbrsue.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// // Firebase token verify middleware
// async function verifyToken(req, res, next) {
//   const authHeader = req.headers.authorization;
//   if (!authHeader || !authHeader.startsWith("Bearer "))
//     return res.status(401).json({ error: "Unauthorized" });
//   const token = authHeader.split(" ")[1];
//   try {
//     const decoded = await admin.auth().verifyIdToken(token);
//     req.user = decoded;
//     next();
//   } catch (err) {
//     console.error(err);
//     res.status(403).json({ error: "Forbidden" });
//   }
// }

// // Role-based middleware
// function checkRole(role) {
//   return (req, res, next) => {
//     if (!req.user || req.user.role !== role)
//       return res.status(403).json({ error: "Forbidden" });
//     next();
//   };
// }

// Connect to MongoDB
async function run() {
  try {
    // await client.connect();
    console.log("✅ MongoDB connected");

    const db = client.db("ClubSphere_DB");
    const eventCollection = db.collection("events");
    const clubCollection = db.collection("clubs");

    /* -------------------------------------------------------------------------- */
    /*                               // !Club Api's                               */
    /* -------------------------------------------------------------------------- */
    app.post("/clubs", async (req, res) => {
      const clubData = req.body;
      const result = await clubCollection.insertOne(clubData);
      res.send(result);
    });

    app.get("/clubs", async (req, res) => {
      const result = await clubCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/clubs/:id", async (req, res) => {
      const id = req.params.id;
      const result = await clubCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    /* -------------------------------------------------------------------------- */
    /*                              // !Events API's                              */
    /* -------------------------------------------------------------------------- */
    app.post("/events", async (req, res) => {
      const eventData = req.body;
      const result = await eventCollection.insertOne(eventData);
      res.send(result);
    });

    app.get("/events", async (req, res) => {
      const result = await eventCollection.find().toArray();
      res.send(result);
    });

    app.get("/events/:id", async (req, res) => {
      const id = req.params.id;
      const result = await eventCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // ROOT
    app.get("/", (req, res) => {
      res.send("Hello from ClubSphere Backend ✅");
    });

    app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
  } catch (err) {
    console.error(err);
  }
}
run().catch(console.dir);
