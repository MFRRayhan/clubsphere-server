const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// MongoDB URI with credentials from environment variables
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.erbrsue.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Connect to MongoDB
async function run() {
  try {
    await client.connect();
    // Ping the database to confirm connection
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Successfully connected to MongoDB!");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
  // Do not close the client if you want to keep the connection open
  // finally {
  //   await client.close();
  // }
}

run().catch(console.dir);

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get("/", (req, res) => {
  res.send("Hello from ClubSphere");
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
