// index.js - Full ClubSphere Backend
require("dotenv").config();
const express = require("express");
const cors = require("cors");
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
    const userCollection = db.collection("users");

    /* -------------------------------------------------------------------------- */
    /*                               // !Club Api's                               */
    /* -------------------------------------------------------------------------- */
    app.post("/clubs", async (req, res) => {
      const clubData = req.body;
      const result = await clubCollection.insertOne(clubData);
      res.send(result);
    });

    app.get("/clubs/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await clubCollection.findOne(query);
      res.send(result);
    });

    // get clubs by email
    app.get("/clubs", async (req, res) => {
      const query = {};
      const { email } = req.query;

      if (email) {
        query.managerEmail = email;
      }
      const cursor = clubCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    // Delete Api - club
    app.delete("/clubs/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await clubCollection.deleteOne(query);
      res.send(result);
    });

    // GET /my-clubs
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
          // Admin sees all approved clubs
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

    /* -------------------------------------------------------------------------- */
    /*                              // !Events API's                              */
    /* -------------------------------------------------------------------------- */
    app.post("/events", async (req, res) => {
      const eventData = req.body;
      const result = await eventCollection.insertOne(eventData);
      res.send(result);
    });

    app.get("/events", verifyFBToken, async (req, res) => {
      const query = {};
      const { email } = req.query;

      if (email) {
        query["eventCreator.email"] = email;
      }

      const result = await eventCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/events/:id", async (req, res) => {
      const id = req.params.id;
      const result = await eventCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.delete("/events/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await eventCollection.deleteOne(query);
      res.send(result);
    });

    /* -------------------------------------------------------------------------- */
    /*                               // !Users Api's                              */
    /* -------------------------------------------------------------------------- */
    app.post("/users", async (req, res) => {
      const userData = req.body;
      userData.createdAt = new Date().toISOString();
      userData.lastLoggedIn = new Date().toISOString();
      userData.role = "member";

      const query = { email: userData?.email };

      const alreadyExists = await userCollection.findOne(query);

      if (alreadyExists) {
        const result = await userCollection.updateOne(query, {
          $set: { lastLoggedIn: new Date().toISOString() },
        });
        return res.send(result);
      }

      const result = await userCollection.insertOne(userData);
      res.send(result);
    });

    // GET user role by email
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      try {
        const user = await userCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        res.json({ role: user.role || "member" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // GET /users?searchText=
    app.get("/users", async (req, res) => {
      const searchText = req.query.searchText || "";

      try {
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
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.patch("/users/:id/role", async (req, res) => {
      const userId = req.params.id;
      const { role } = req.body;

      if (!role) return res.status(400).json({ message: "Role is required" });

      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role } }
        );
        res.json(result); // frontend চেক করে modifiedCount
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // DELETE /users/:id
    app.delete("/users/:id", async (req, res) => {
      const userId = req.params.id;

      try {
        const result = await userCollection.deleteOne({
          _id: new ObjectId(userId),
        });
        res.json(result); // frontend চেক করে deletedCount
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    /* -------------------------------------------------------------------------- */
    /*                               // !Stripe Payment                          */
    /* -------------------------------------------------------------------------- */
    // app.post("/create-payment-intent", async (req, res) => {
    //   try {
    //     const { event, user } = req.body;

    //     if (!event || !user) {
    //       return res
    //         .status(400)
    //         .json({ error: "Event and user data required" });
    //     }

    //     // Stripe expects amount in cents
    //     const amount = event.isPaid ? Math.round(event.eventFee * 100) : 0;

    //     const paymentIntent = await stripe.paymentIntents.create({
    //       amount,
    //       currency: "usd",
    //       description: `Payment for event: ${event.title}`,
    //       metadata: {
    //         eventId: event._id,
    //         eventName: event.title,
    //         userEmail: user.email,
    //         userName: user.name,
    //       },
    //     });

    //     res.json({ clientSecret: paymentIntent.client_secret });
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).json({ error: "Stripe payment intent failed" });
    //   }
    // });

    // Payment for Events
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
                product_data: {
                  name: event.eventName,
                },
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

    // Payments for Club membership
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
                product_data: {
                  name: `Membership - ${club.clubName}`,
                },
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
