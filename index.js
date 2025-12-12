require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Firebase Admin Init
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

// Firebase Auth Token Verify
const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).send({ message: "Unauthorized Access" });

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    res.status(401).send({ message: "Unauthorized Access" });
  }
};

// MongoDB
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.erbrsue.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    console.log("MongoDB connected");

    const db = client.db("ClubSphere_DB");
    const eventCollection = db.collection("events");
    const clubCollection = db.collection("clubs");
    const userCollection = db.collection("users");
    const membershipCollection = db.collection("memberships");

    /* ------------------------------ Club APIs ------------------------------ */

    app.post("/clubs", verifyFBToken, async (req, res) => {
      const clubData = req.body;
      clubData.managerEmail = req.decoded_email;
      clubData.status = "pending";
      clubData.createdAt = new Date().toISOString();
      clubData.updatedAt = new Date().toISOString();

      const result = await clubCollection.insertOne(clubData);
      res.send(result);
    });

    app.patch("/clubs/:id/status", verifyFBToken, async (req, res) => {
      const { status } = req.body;
      const id = req.params.id;

      const result = await clubCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status, updatedAt: new Date().toISOString() } }
      );

      res.json(result);
    });

    app.get("/clubs/:id", async (req, res) => {
      const id = req.params.id;
      const result = await clubCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.get("/clubs", async (req, res) => {
      const { email, status } = req.query;
      const query = {};

      query.status = status || "approved";
      if (email) query.managerEmail = email;

      const result = await clubCollection
        .find(query)
        .sort({ updatedAt: -1 })
        .toArray();
      res.send(result);
    });

    app.delete("/clubs/:id", async (req, res) => {
      const id = req.params.id;
      const result = await clubCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.get("/my-clubs", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;
        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });

        let clubs = [];

        if (user.role === "clubManager") {
          clubs = await clubCollection
            .find({ managerEmail: email })
            .sort({ createdAt: -1 })
            .toArray();
        } else if (user.role === "member") {
          const memberships = await membershipCollection
            .find({ userEmail: email, status: "active" })
            .toArray();

          const clubIds = memberships.map((m) => new ObjectId(m.clubId));
          clubs = await clubCollection
            .find({ _id: { $in: clubIds } })
            .toArray();
        } else if (user.role === "admin") {
          clubs = await clubCollection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
        }

        res.json(clubs);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    /* --------------------------- Membership APIs --------------------------- */

    app.post("/memberships", verifyFBToken, async (req, res) => {
      const { clubId, clubName, clubFee } = req.body;
      const userEmail = req.decoded_email;

      if (!clubId || !clubName || !clubFee) {
        return res.status(400).send({ message: "Missing required fields" });
      }

      const existing = await membershipCollection.findOne({
        userEmail,
        clubId,
        status: "active",
      });

      if (existing) {
        return res.status(200).send({ message: "Already an active member" });
      }

      const membershipData = {
        clubId,
        clubName,
        userEmail,
        status: "active",
        membershipFee: clubFee,
        purchaseDate: new Date().toISOString(),
      };

      const result = await membershipCollection.insertOne(membershipData);
      res.send(result);
    });

    // Get all active memberships for the logged-in user
    app.get("/memberships/active", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.decoded_email;

        if (!userEmail) {
          return res
            .status(401)
            .send({ message: "Unauthorized access: Missing email." });
        }

        const activeMemberships = await membershipCollection
          .find({ userEmail, status: "active" })
          .toArray();

        res.send(activeMemberships);
      } catch (error) {
        console.error("Error fetching active memberships:", error);
        res
          .status(500)
          .send({ message: "Server error while fetching memberships." });
      }
    });

    app.get(
      "/memberships/check-status/:clubId",
      verifyFBToken,
      async (req, res) => {
        const { clubId } = req.params;
        const userEmail = req.decoded_email;

        const membership = await membershipCollection.findOne({
          clubId,
          userEmail,
          status: "active",
        });

        res.json({ isMember: !!membership });
      }
    );

    // Cancel membership (just update status)
    app.patch("/memberships/cancel/:id", verifyFBToken, async (req, res) => {
      const membershipId = req.params.id;
      const userEmail = req.decoded_email;

      try {
        const result = await membershipCollection.updateOne(
          { _id: new ObjectId(membershipId), userEmail },
          {
            $set: {
              status: "cancelled",
              cancelledAt: new Date().toISOString(),
            },
          }
        );

        if (result.modifiedCount > 0) {
          res.json({ modifiedCount: result.modifiedCount });
        } else {
          res
            .status(404)
            .json({ message: "Membership not found or already cancelled" });
        }
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .json({ message: "Server error while cancelling membership" });
      }
    });

    /* ------------------------------ Events APIs ----------------------------- */

    app.post("/events", async (req, res) => {
      const result = await eventCollection.insertOne(req.body);
      res.send(result);
    });

    app.get("/events", verifyFBToken, async (req, res) => {
      const query = {};
      if (req.query.email) query["eventCreator.email"] = req.query.email;

      const result = await eventCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/events/:id", async (req, res) => {
      const id = req.params.id;
      const result = await eventCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.delete("/events/:id", async (req, res) => {
      const id = req.params.id;
      const result = await eventCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    /* ------------------------------- Users APIs ----------------------------- */

    app.post("/users", async (req, res) => {
      const userData = req.body;
      userData.createdAt = new Date().toISOString();
      userData.lastLoggedIn = new Date().toISOString();
      userData.role = "member";

      const query = { email: userData.email };
      const existing = await userCollection.findOne(query);

      if (existing) {
        const result = await userCollection.updateOne(query, {
          $set: { lastLoggedIn: new Date().toISOString() },
        });
        return res.send(result);
      }

      const result = await userCollection.insertOne(userData);
      res.send(result);
    });

    app.get("/users/:email/role", async (req, res) => {
      const user = await userCollection.findOne({ email: req.params.email });
      if (!user) return res.status(404).json({ message: "User not found" });

      res.json({ role: user.role || "member" });
    });

    app.get("/users", async (req, res) => {
      const searchText = req.query.searchText || "";
      const query = searchText
        ? {
            $or: [
              { displayName: { $regex: searchText, $options: "i" } },
              { email: { $regex: searchText, $options: "i" } },
            ],
          }
        : {};

      const users = await userCollection.find(query).toArray();
      res.json(users);
    });

    app.patch("/users/:id/role", async (req, res) => {
      const result = await userCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { role: req.body.role } }
      );
      res.json(result);
    });

    app.delete("/users/:id", async (req, res) => {
      const result = await userCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.json(result);
    });

    /* ---------------------------- Stripe Payments --------------------------- */

    app.post("/create-checkout-session", async (req, res) => {
      const { event, user } = req.body;

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: user.email,
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: event.eventName },
                unit_amount: event.eventFee * 100,
              },
              quantity: 1,
            },
          ],
          success_url: `${process.env.SITE_DOMAIN}/events/${event._id}?payment=success`,
          cancel_url: `${process.env.SITE_DOMAIN}/events/${event._id}?payment=cancel`,
        });

        res.json({ url: session.url });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/create-club-membership-session", async (req, res) => {
      const { club, user } = req.body;

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: user.email,
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: `Membership - ${club.clubName}` },
                unit_amount: club.membershipFee * 100,
              },
              quantity: 1,
            },
          ],
          success_url: `${process.env.SITE_DOMAIN}/clubs/${club._id}?payment=success`,
          cancel_url: `${process.env.SITE_DOMAIN}/clubs/${club._id}?payment=cancel`,
        });

        res.json({ url: session.url });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /* --------------------------------- Root --------------------------------- */

    app.get("/", (req, res) => {
      res.send("Hello from ClubSphere Backend");
    });

    app.listen(port, () => console.log(`Server running on port ${port}`));
  } catch (err) {
    console.error(err);
  }
}

run().catch(console.dir);
