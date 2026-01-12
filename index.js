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
    origin: [`${process.env.SITE_DOMAIN}`],
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
    const eventParticipationCollection = db.collection("eventParticipants");
    const paymentCollection = db.collection("payments");
    const blogCollection = db.collection("blogs");

    // Verify Admin
    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded_email;

        if (!email) {
          return res.status(401).send({ message: "Unauthorized" });
        }

        const user = await userCollection.findOne({ email });

        if (!user || user.role !== "admin") {
          return res.status(403).send({ message: "Forbidden: Admin only" });
        }

        next();
      } catch (error) {
        console.error("verifyAdmin error:", error);
        res.status(500).send({ message: "Admin verification failed" });
      }
    };

    // Verify ClubManager
    const verifyManager = async (req, res, next) => {
      try {
        const email = req.decoded_email;

        if (!email) {
          return res.status(401).send({ message: "Unauthorized" });
        }

        const user = await userCollection.findOne({ email });

        if (!user || user.role !== "clubManager") {
          return res
            .status(403)
            .send({ message: "Forbidden: ClubManager only" });
        }

        next();
      } catch (error) {
        console.error("verifyClubManager error:", error);
        res.status(500).send({ message: "ClubManager verification failed" });
      }
    };

    /* -------------------------------------------------------------------------- */
    /*                                  !Club APIs                                */
    /* -------------------------------------------------------------------------- */

    app.post("/clubs", verifyFBToken, async (req, res) => {
      const clubData = req.body;
      clubData.managerEmail = req.decoded_email;
      clubData.status = "pending";
      clubData.createdAt = new Date().toISOString();
      clubData.updatedAt = new Date().toISOString();

      const result = await clubCollection.insertOne(clubData);
      res.send(result);
    });

    app.patch(
      "/clubs/:id/status",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { status } = req.body;
        const id = req.params.id;

        const result = await clubCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status, updatedAt: new Date().toISOString() } }
        );

        res.json(result);
      }
    );

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

    app.delete("/clubs/:id", verifyFBToken, async (req, res) => {
      const clubId = req.params.id;
      const email = req.decoded_email;

      if (!ObjectId.isValid(clubId)) {
        return res.status(400).json({ message: "Invalid club ID" });
      }

      try {
        const user = await userCollection.findOne({ email });
        if (!user) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        const club = await clubCollection.findOne({
          _id: new ObjectId(clubId),
        });

        if (!club) {
          return res.status(404).json({ message: "Club not found" });
        }

        const isAdmin = user.role === "admin";
        const isManagerOwner =
          user.role === "clubManager" && club.managerEmail === email;

        if (!isAdmin && !isManagerOwner) {
          return res.status(403).json({ message: "Forbidden access" });
        }

        const result = await clubCollection.deleteOne({ _id: club._id });

        res.json({
          deletedCount: result.deletedCount,
          message: "Club deleted successfully",
        });
      } catch (error) {
        console.error("Delete club error:", error);
        res.status(500).json({ message: "Server error" });
      }
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

    // Club manager get his subscribed members in dashboard API
    app.get(
      "/manager/club-members/:clubId",
      verifyFBToken,
      async (req, res) => {
        const clubId = req.params.clubId;
        const managerEmail = req.decoded_email;

        if (!ObjectId.isValid(clubId)) {
          return res.status(400).send({ message: "Invalid club id" });
        }

        try {
          const club = await clubCollection.findOne({
            _id: new ObjectId(clubId),
            managerEmail,
          });

          if (!club) {
            return res.status(403).send({ message: "Forbidden access" });
          }

          const members = await membershipCollection
            .aggregate([
              {
                $match: {
                  clubId,
                  status: "active",
                },
              },
              {
                $lookup: {
                  from: "users",
                  localField: "userEmail",
                  foreignField: "email",
                  as: "userInfo",
                },
              },
              { $unwind: "$userInfo" },
              {
                $project: {
                  userEmail: 1,
                  clubName: 1,
                  purchaseDate: 1,
                  membershipFee: 1,
                  "userInfo.displayName": 1,
                  "userInfo.photoURL": 1,
                },
              },
            ])
            .toArray();

          res.send(members);
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    // Manager → My Events
    app.get("/manager/my-events", verifyFBToken, async (req, res) => {
      try {
        const managerEmail = req.decoded_email;

        // Check role
        const manager = await userCollection.findOne({ email: managerEmail });
        if (!manager || manager.role !== "clubManager") {
          return res.status(403).send({ message: "Forbidden access" });
        }

        // Directly fetch events created by this manager
        const events = await eventCollection
          .find({ "eventCreator.email": managerEmail })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(events);
      } catch (error) {
        console.error("Manager events error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get(
      "/manager/payments",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const managerEmail = req.decoded_email;

          const payments = await paymentCollection
            .find({ managerEmail })
            .sort({ paidAt: -1 })
            .toArray();

          res.status(200).json(payments);
        } catch (error) {
          console.error("Manager payment error:", error);
          res.status(500).json({ message: "Failed to load payments" });
        }
      }
    );

    // Update full club details
    app.patch("/clubs/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;

      const allowedFields = [
        "clubName",
        "description",
        "category",
        "location",
        "membershipFee",
        "bannerImage",
        "status",
      ];

      const setData = {};
      allowedFields.forEach((field) => {
        if (updateData[field] !== undefined) setData[field] = updateData[field];
      });

      setData.updatedAt = new Date().toISOString();

      try {
        const result = await clubCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: setData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Club not found" });
        }

        res.json({ message: "Club updated successfully", result });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error while updating club" });
      }
    });

    /* -------------------------------------------------------------------------- */
    /*                              !Membership APIs                              */
    /* -------------------------------------------------------------------------- */

    app.post("/memberships", verifyFBToken, async (req, res) => {
      const { clubId, clubName, clubFee } = req.body;
      const userEmail = req.decoded_email;

      if (!clubId || !clubName || clubFee === undefined || clubFee === null) {
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

    app.post("/events", verifyFBToken, async (req, res) => {
      try {
        const {
          clubId,
          eventName,
          eventDescription,
          eventDate,
          location,
          isPaid,
          eventFee,
          maxAttendees,
          eventBanner,
          eventCategory,
          eventCreator,
        } = req.body;

        const club = await clubCollection.findOne({
          _id: new ObjectId(clubId),
        });
        if (!club) return res.status(404).send({ message: "Club not found" });

        const eventData = {
          clubId,
          clubName: club.clubName,
          eventName,
          eventDescription,
          eventDate,
          location,
          isPaid,
          eventFee,
          maxAttendees: maxAttendees || null,
          eventBanner,
          eventCategory,

          status: "pending",
          approvedBy: null,

          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),

          eventCreator: {
            name: eventCreator?.name || null,
            email: req.decoded_email,
            image: eventCreator?.image || null,
          },
        };

        const result = await eventCollection.insertOne(eventData);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error while creating event" });
      }
    });

    app.get("/admin/events", verifyFBToken, verifyAdmin, async (req, res) => {
      const status = req.query.status || "pending";
      const events = await eventCollection
        .find({ status })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(events);
    });

    app.patch(
      "/admin/events/:id/status",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { status } = req.body;
        const id = req.params.id;

        if (!["approved", "rejected"].includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const result = await eventCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status,
              approvedBy: req.decoded_email,
              updatedAt: new Date().toISOString(),
            },
          }
        );

        res.send(result);
      }
    );

    app.get("/events", async (req, res) => {
      const query = {};
      if (req.query.email) query["eventCreator.email"] = req.query.email;
      if (req.query.status) query.status = req.query.status;
      if (!req.query.status) query.status = "approved";

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

    app.delete("/events/:id", verifyFBToken, async (req, res) => {
      const eventId = req.params.id;
      const email = req.decoded_email;

      if (!ObjectId.isValid(eventId)) {
        return res.status(400).json({ message: "Invalid event ID" });
      }

      try {
        const user = await userCollection.findOne({ email });
        if (!user) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        const event = await eventCollection.findOne({
          _id: new ObjectId(eventId),
        });

        if (!event) {
          return res.status(404).json({ message: "Event not found" });
        }

        const isAdmin = user.role === "admin";
        const isManagerOwner =
          user.role === "clubManager" && event.eventCreator?.email === email;

        if (!isAdmin && !isManagerOwner) {
          return res.status(403).json({ message: "Forbidden access" });
        }

        await eventCollection.deleteOne({ _id: event._id });

        res.json({ message: "Event deleted successfully" });
      } catch (error) {
        console.error("Delete event error:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Update Event (Manager)
    app.patch("/events/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const managerEmail = req.decoded_email;
      const updateData = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid event id" });
      }

      // Allowed fields only (security)
      const allowedFields = [
        "eventName",
        "eventDescription",
        "eventDate",
        "location",
        "isPaid",
        "eventFee",
        "eventCategory",
        "eventBanner",
        "maxAttendees",
      ];

      const setData = {};
      allowedFields.forEach((field) => {
        if (updateData[field] !== undefined) {
          setData[field] = updateData[field];
        }
      });

      setData.updatedAt = new Date().toISOString();

      try {
        // 🔒 Ensure manager owns this event
        const result = await eventCollection.updateOne(
          {
            _id: new ObjectId(id),
            "eventCreator.email": managerEmail,
          },
          { $set: setData }
        );

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ message: "Event not found or unauthorized" });
        }

        res.json({
          message: "Event updated successfully",
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Update event error:", error);
        res.status(500).json({ message: "Server error while updating event" });
      }
    });

    // Get participation status for a specific event and user
    app.get(
      "/events/check-participant/:eventId",
      verifyFBToken,
      async (req, res) => {
        const { eventId } = req.params;
        const userEmail = req.decoded_email;

        try {
          const participation = await eventParticipationCollection.findOne({
            eventId,
            userEmail,
          });

          res.json({ isParticipant: !!participation });
        } catch (error) {
          console.error(error);
          res.status(500).json({ message: "Server error checking status" });
        }
      }
    );

    // Record user participation after successful payment
    app.post("/event-participants", verifyFBToken, async (req, res) => {
      const { eventId, eventName, eventFee } = req.body;
      const userEmail = req.decoded_email;

      if (!eventId || !eventName) {
        return res.status(400).send({ message: "Missing required fields" });
      }

      const existing = await eventParticipationCollection.findOne({
        userEmail,
        eventId,
      });

      if (existing) {
        return res.status(200).send({ message: "Already joined this event" });
      }

      const participationData = {
        eventId,
        eventName,
        userEmail,
        status: eventFee > 0 ? "paid" : "joined",
        fee: eventFee || 0,
        joinDate: new Date().toISOString(),
      };

      const result = await eventParticipationCollection.insertOne(
        participationData
      );
      res.send(result);
    });

    // Get all participations for the logged-in user
    app.get("/my-participations", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.decoded_email;

        if (!userEmail) {
          return res
            .status(401)
            .send({ message: "Unauthorized access: Missing email." });
        }

        const participations = await eventParticipationCollection
          .find({ userEmail })
          .sort({ joinDate: -1 })
          .toArray();

        res.send(participations);
      } catch (error) {
        console.error("Error fetching event participations:", error);
        res
          .status(500)
          .send({ message: "Server error while fetching participations." });
      }
    });

    app.delete("/event-participants/:id", verifyFBToken, async (req, res) => {
      const participationId = req.params.id;
      const userEmail = req.decoded_email;

      if (!ObjectId.isValid(participationId)) {
        return res
          .status(400)
          .send({ message: "Invalid participation ID format." });
      }

      try {
        const query = {
          _id: new ObjectId(participationId),
          userEmail: userEmail,
        };

        const result = await eventParticipationCollection.deleteOne(query);

        if (result.deletedCount === 0) {
          return res
            .status(404)
            .send({ message: "Participation record not found." });
        }

        res.send({
          deletedCount: result.deletedCount,
          message: "Successfully unjoined the event.",
        });
      } catch (error) {
        console.error("Error deleting participation record:", error);
        res
          .status(500)
          .send({ message: "Server error during unjoin operation." });
      }
    });

    // Manager → get all active events with registrations
    app.get(
      "/manager/my-active-events-with-registrations",
      verifyFBToken,
      async (req, res) => {
        try {
          const managerEmail = req.decoded_email;

          const manager = await userCollection.findOne({ email: managerEmail });
          if (!manager || manager.role !== "clubManager") {
            return res.status(403).send({ message: "Forbidden access" });
          }

          const events = await eventCollection
            .find({ "eventCreator.email": managerEmail, status: "approved" })
            .sort({ createdAt: -1 })
            .toArray();

          const eventsWithRegistrations = await Promise.all(
            events.map(async (event) => {
              const participants = await eventParticipationCollection
                .aggregate([
                  { $match: { eventId: event._id.toString() } }, // string match
                  {
                    $lookup: {
                      from: "users",
                      localField: "userEmail",
                      foreignField: "email",
                      as: "userInfo",
                    },
                  },
                  {
                    $unwind: {
                      path: "$userInfo",
                      preserveNullAndEmptyArrays: true,
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      userEmail: 1,
                      status: 1,
                      fee: 1,
                      joinDate: 1,
                      userName: {
                        $ifNull: ["$userInfo.displayName", "$userEmail"],
                      },
                    },
                  },
                ])
                .toArray();

              return {
                ...event,
                participants,
              };
            })
          );

          res.json(eventsWithRegistrations);
        } catch (error) {
          console.error(error);
          res.status(500).json({ message: "Server error" });
        }
      }
    );

    // Manager kicks a participant from an event
    app.delete(
      "/manager/event-participants/:eventId/:participantId",
      verifyFBToken,
      async (req, res) => {
        const { eventId, participantId } = req.params;
        const managerEmail = req.decoded_email;

        if (!ObjectId.isValid(participantId)) {
          return res.status(400).json({ message: "Invalid participant ID" });
        }

        try {
          // 1️⃣ Check if manager owns the event
          const event = await eventCollection.findOne({
            _id: new ObjectId(eventId),
            "eventCreator.email": managerEmail,
          });

          if (!event) {
            return res.status(403).json({ message: "Forbidden access" });
          }

          // 2️⃣ Delete participant
          const result = await eventParticipationCollection.deleteOne({
            _id: new ObjectId(participantId),
          });

          if (result.deletedCount === 0) {
            return res
              .status(404)
              .json({ message: "Participant not found in this event" });
          }

          res.json({ message: "Participant kicked successfully" });
        } catch (error) {
          console.error("Error kicking participant:", error);
          res
            .status(500)
            .json({ message: "Server error while kicking participant" });
        }
      }
    );

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

    app.get("/users", verifyFBToken, verifyAdmin, async (req, res) => {
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

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { role: req.body.role } }
        );
        res.json(result);
      }
    );

    app.delete("/users/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.json(result);
    });

    // Update user profile
    app.patch("/users/profile", verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const updateData = req.body;

      const allowedFields = ["displayName", "photoURL"];
      const setData = {};

      allowedFields.forEach((field) => {
        if (updateData[field] !== undefined) {
          setData[field] = updateData[field];
        }
      });

      setData.updatedAt = new Date().toISOString();

      try {
        const result = await userCollection.updateOne(
          { email },
          { $set: setData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json({ message: "Profile updated successfully" });
      } catch (error) {
        console.error("Profile update error:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    /* ---------------------------- Stripe Payments --------------------------- */

    app.post("/create-checkout-session", verifyFBToken, async (req, res) => {
      const { event, user } = req.body;

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: user.email,
          line_items: [
            {
              price_data: {
                currency: "BDT",
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

      if (!club || !club.clubName || club.membershipFee == null) {
        return res.status(400).json({ message: "Missing club data" });
      }

      if (!user || !user.email) {
        return res.status(400).json({ message: "Missing user email" });
      }

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: user.email,
          line_items: [
            {
              price_data: {
                currency: "BDT",
                product_data: { name: `Membership - ${club.clubName}` },
                unit_amount: Math.round(Number(club.membershipFee) * 100),
              },
              quantity: 1,
            },
          ],
          success_url: `${process.env.SITE_DOMAIN}/clubs/${club._id}?payment=success`,
          cancel_url: `${process.env.SITE_DOMAIN}/clubs/${club._id}?payment=cancel`,
        });

        res.json({ url: session.url });
      } catch (error) {
        console.error("Stripe Error:", error);
        res.status(500).json({ error: error.message });
      }
    });

    /* -------------------------------------------------------------------------- */
    /*                               !Payment API's                               */
    /* -------------------------------------------------------------------------- */

    // Save a new payment record for the logged-in user
    app.post("/payments", verifyFBToken, async (req, res) => {
      const { transactionId, amount, paymentType, clubId, eventId } = req.body;
      const userEmail = req.decoded_email;
      let managerEmail = null;
      let clubName = null;

      if (clubId) {
        const club = await clubCollection.findOne({
          _id: new ObjectId(clubId),
        });
        if (!club) return res.status(404).send({ message: "Club not found" });

        managerEmail = club.managerEmail;
        clubName = club.clubName;
      }

      if (eventId) {
        const event = await eventCollection.findOne({
          _id: new ObjectId(eventId),
        });
        if (!event) return res.status(404).send({ message: "Event not found" });

        managerEmail = event.eventCreator.email;
        clubName = event.clubName;
      }

      if (!managerEmail)
        return res.status(400).send({ message: "Manager email missing" });

      const paymentData = {
        transactionId,
        amount,
        paymentType,
        clubId: clubId || null,
        eventId: eventId || null,
        clubName,
        managerEmail,
        userEmail,
        paidAt: new Date().toISOString(),
      };

      const result = await paymentCollection.insertOne(paymentData);
      res.status(201).json(result);
    });

    // get payment history for Admin
    app.get("/admin/payments", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const payments = await paymentCollection
          .find({})
          .sort({ paidAt: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error("Admin payments error:", error);
        res.status(500).send({ message: "Failed to load payments" });
      }
    });

    // Payment History API - Get all payments for the logged-in user
    app.get("/payments/history", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.decoded_email;

        const payments = await paymentCollection
          .find({ userEmail })
          .sort({ paidAt: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error("Error fetching payment history:", error);
        res
          .status(500)
          .send({ message: "Server error while fetching payments." });
      }
    });

    // Update payment status to ban or remove a member
    app.patch("/payments/:id/status", verifyFBToken, async (req, res) => {
      const paymentId = req.params.id;
      const { status } = req.body;

      if (!ObjectId.isValid(paymentId)) {
        return res.status(400).json({ message: "Invalid Payment ID" });
      }

      try {
        const result = await paymentCollection.updateOne(
          { _id: new ObjectId(paymentId) },
          {
            $set: {
              status: status,
              updatedAt: new Date().toISOString(),
            },
          }
        );

        if (result.modifiedCount > 0) {
          res.json({ modifiedCount: result.modifiedCount });
        } else {
          res.status(404).json({
            message: "Payment record not found or status already set",
          });
        }
      } catch (error) {
        console.error("Error updating member status:", error);
        res.status(500).json({ message: "Server error while updating status" });
      }
    });

    /* --------------------------- Admin Dashboard stats API -------------------------- */
    app.get(
      "/admin/dashboard-stats",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const totalUsers = await userCollection.countDocuments();
          const totalClubs = await clubCollection.countDocuments();
          const totalEvents = await eventCollection.countDocuments();

          const pendingClubs = await clubCollection.countDocuments({
            status: "pending",
          });

          const pendingEvents = await eventCollection.countDocuments({
            status: "pending",
          });

          const payments = await paymentCollection.find({}).toArray();
          const totalPayments = payments.length;
          const totalRevenue = payments.reduce(
            (sum, p) => sum + Number(p.amount || 0),
            0
          );

          res.send({
            totalUsers,
            totalClubs,
            totalEvents,
            pendingApprovals: pendingClubs + pendingEvents,
            pendingClubs,
            pendingEvents,
            totalPayments,
            totalRevenue,
          });
        } catch (error) {
          console.error("Dashboard stats error:", error);
          res.status(500).send({ message: "Failed to load dashboard stats" });
        }
      }
    );

    /* --------------------------- Club Manager Dashboard stats API -------------------------- */
    app.get(
      "/manager/dashboard-stats",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const managerEmail = req.decoded_email;

          const managedClubs = await clubCollection
            .find({ managerEmail })
            .toArray();

          const clubIds = managedClubs.map((c) => c._id.toString());

          const totalMembers = await membershipCollection.countDocuments({
            clubId: { $in: clubIds },
            status: "active",
          });

          const managedEvents = await eventCollection
            .find({ "eventCreator.email": managerEmail })
            .toArray();

          const eventIds = managedEvents.map((e) => e._id.toString());

          const totalRegistrations =
            await eventParticipationCollection.countDocuments({
              eventId: { $in: eventIds },
            });

          const payments = await paymentCollection
            .find({
              $or: [
                { clubId: { $in: clubIds } },
                { eventId: { $in: eventIds } },
              ],
            })
            .toArray();

          const totalPayments = payments.length;
          const totalRevenue = payments.reduce(
            (sum, p) => sum + Number(p.amount || 0),
            0
          );

          res.send({
            totalClubs: managedClubs.length,
            totalMembers,
            totalEvents: managedEvents.length,
            totalRegistrations,
            totalPayments,
            totalRevenue,
          });
        } catch (error) {
          console.error("Manager dashboard error:", error);
          res.status(500).send({ message: "Failed to load manager stats" });
        }
      }
    );

    /* --------------------------- Member Dashboard stats API -------------------------- */
    app.get("/member/dashboard-stats", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.decoded_email;

        const totalClubs = await membershipCollection.countDocuments({
          userEmail,
          status: "active",
        });

        const totalEvents = await eventParticipationCollection.countDocuments({
          userEmail,
        });

        res.send({
          totalClubs,
          totalEvents,
        });
      } catch (error) {
        console.error("Member dashboard error:", error);
        res.status(500).send({ message: "Failed to load member stats" });
      }
    });

    /* -------------------------------------------------------------------------- */
    /*                                !Blog API's                                 */
    /* -------------------------------------------------------------------------- */

    // Create a blog
    app.post("/blogs", verifyFBToken, async (req, res) => {
      try {
        const blog = req.body;
        const email = req.decoded_email;

        const user = await userCollection.findOne({ email });
        if (!user || user.role === "member") {
          return res.status(403).send({ message: "Forbidden" });
        }

        const blogData = {
          title: blog.title,
          description: blog.description,
          content: blog.content,
          image: blog.image,
          category: blog.category,
          author: {
            name: user.displayName || email,
            email,
            photo: user.photoURL || null,
          },
          status: "pending",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = await blogCollection.insertOne(blogData);
        res.send(result);
      } catch (error) {
        console.error("Create blog error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Public API - approved blogs
    app.get("/public/blogs", async (req, res) => {
      try {
        const blogs = await blogCollection
          .find({ status: "approved" })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(blogs);
      } catch (error) {
        console.error("Get public blogs error:", error);
        res.status(500).send({ message: "Failed to load blogs" });
      }
    });

    // Get all blogs (for clubManager → own blogs, admin → all approved)
    app.get("/blogs", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;
        const user = await userCollection.findOne({ email });

        if (!user) return res.status(403).send({ message: "User not found" });

        let query = { status: "approved" };

        if (user.role === "clubManager") {
          query["author.email"] = email; // only own blogs
        }
        // admin gets all approved blogs

        const blogs = await blogCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.send(blogs);
      } catch (error) {
        console.error("Get blogs error:", error);
        res.status(500).send({ message: "Failed to load blogs" });
      }
    });

    // Get single blog by ID
    app.get("/blogs/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid blog ID" });
        }

        const blog = await blogCollection.findOne({ _id: new ObjectId(id) });

        if (!blog) return res.status(404).send({ message: "Blog not found" });

        res.send(blog);
      } catch (error) {
        console.error("Get blog error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Admin: update blog status
    app.patch(
      "/admin/blogs/:id/status",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { status } = req.body;

          if (!["approved", "rejected"].includes(status)) {
            return res.status(400).send({ message: "Invalid status" });
          }

          const result = await blogCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            {
              $set: {
                status,
                updatedAt: new Date().toISOString(),
              },
            }
          );

          res.send(result);
        } catch (error) {
          console.error("Update blog status error:", error);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    // Admin: get all blogs
    app.get("/admin/blogs", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const blogs = await blogCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();
        res.send(blogs);
      } catch (error) {
        console.error("Get all admin blogs error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Delete blog (admin → any blog, clubManager → own blogs)
    app.delete("/blogs/:id", verifyFBToken, async (req, res) => {
      try {
        const blogId = req.params.id;
        const email = req.decoded_email;

        if (!ObjectId.isValid(blogId)) {
          return res.status(400).send({ message: "Invalid blog ID" });
        }

        const blog = await blogCollection.findOne({
          _id: new ObjectId(blogId),
        });
        if (!blog) return res.status(404).send({ message: "Blog not found" });

        const user = await userCollection.findOne({ email });
        if (!user) return res.status(403).send({ message: "User not found" });

        if (user.role === "admin") {
          // admin can delete any blog
        } else if (user.role === "clubManager") {
          // clubManager can delete only own blog
          if (blog.author.email !== email) {
            return res
              .status(403)
              .send({ message: "You are not allowed to delete this blog" });
          }
        } else {
          return res.status(403).send({ message: "Forbidden" });
        }

        const result = await blogCollection.deleteOne({
          _id: new ObjectId(blogId),
        });
        res.send({ deletedCount: result.deletedCount });
      } catch (error) {
        console.error("Delete blog error:", error);
        res.status(500).send({ message: "Server error" });
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
