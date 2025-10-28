const mongoose = require("mongoose");
const deleteCloudinaryFile = require("../helpers/deleteCloudinaryFile");
const taskModel = require("../models/Task");
const { uploadBufferToCloudinary } = require("../utils/cloudinaryConfig");
const walletModel = require("../models/Wallet");
const transactionModel = require("../models/Transaction");
const reviewModel = require("../models/Review");
const { sendNotification } = require("../services/notificationService");
const userModel = require("../models/User");
const mailsender = require("../services/mailService");
require("dotenv").config();

const createTask = async (req, res) => {
  try {
    const { title, mustHave, description, location, pricing, date, status } =
      req.body;
    let imageUrl = null,
      documentUrl = null,
      videoUrl = null;

    if (req.files?.image) {
      imageUrl = await uploadBufferToCloudinary(
        req.files.image[0].buffer,
        "images",
        "image"
      );
    }

    if (req.files?.document) {
      documentUrl = await uploadBufferToCloudinary(
        req.files.document[0].buffer,
        "documents",
        "raw"
      );
    }

    if (req.files?.video) {
      videoUrl = await uploadBufferToCloudinary(
        req.files.video[0].buffer,
        "videos",
        "video"
      );
    }

    if (!title || !pricing || !date) {
      return res
        .status(400)
        .json({ error: "title, pricing and date are required" });
    }

    const formattedDate = new Date(date);

    if (isNaN(formattedDate)) {
      return res.status(400).json({ error: "Invalid date format" });
    }

    const clientWallet = await walletModel.findOne({ user: req.user._id });

    if (!clientWallet) {
      return res.status(400).json({ error: "Wallet not found" });
    }

    if (clientWallet.balance < pricing) {
      return res
        .status(400)
        .json({ error: "Insufficient wallet balance, plaese top up!" });
    }

    clientWallet.balance -= pricing;
    await clientWallet.save();

    await transactionModel.create({
      user: req.user._id,
      type: "debit",
      amount: pricing,
      description: `Task created: ${title}`,
    });

    const newTask = new taskModel({
      client: req.user._id,
      title,
      mustHave: Array.isArray(mustHave) ? mustHave : mustHave.split(","),
      description,
      location,
      pricing,
      date,
      status: status || "active",
      image: imageUrl,
      document: documentUrl,
      video: videoUrl,
    });

    // const taskers = await userModel.find({
    //   role: "tasker",
    //   location: location,
    //   skillset: { $in: newTask.mustHave },
    // });

    // for (const tasker of taskers) {
    //   const emailBody = newTask.description;
    //   await mailsender(tasker.email, `New task available in your area: ${newTask.title}`, emailBody);
    // }    

    // 🔹 Notify taskers in same area with matching skills
    const taskers = await userModel.find({
      role: "tasker",
      location,
      skillset: { $in: newTask.mustHave },
    });

    for (const tasker of taskers) {
      const emailBody = `
        Hello ${tasker.username || "Tasker"},
        A new task is available near you!
        
        🧩 Task: ${newTask.title}
        💰 Price: ${newTask.pricing}
        📍 Location: ${newTask.location}
        📅 Date: ${newTask.date.toDateString()}
        Description: ${newTask.description}
        click the link below to apply: https://thebestpriceng.com/single-task/${newTask._id}
        
      `;
      await mailsender(
        tasker.email,
        `New task available in your area: ${newTask.title}`,
        emailBody
      );
    }

    const savedTask = await newTask.save();

    return res
      .status(201)
      .json({ message: "Task created successfully", task: savedTask });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }
};

const updateTask = async (req, res) => {
  const allowedFields = [
    "title",
    "mustHave",
    "description",
    "location",
    "pricing",
    "date",
    "status",
  ];
  const allowedStatuses = ["active", "cancelled", "completed"];

  try {
    const task = await taskModel.findById(req.params.id).populate("client");

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    if (!task.client) {
      return res.status(404).json({ error: "Client not found in the task" });
    }

    if (task.client._id.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ error: "Unauthorized to update this Task" });
    }

    for (const field of allowedFields) {
      if (req.body[field]) {
        if (field === "status" && !allowedStatuses.includes(req.body.status)) {
          return res.status(400).json({ error: "Invalid status value" });
        }
        task[field] = req.body[field];
      }
    }

    const mediaTypes = {
      image: "images",
      document: "documents",
      video: "videos",
    };

    for (const [key, folder] of Object.entries(mediaTypes)) {
      if (req.files?.[key]) {
        if (task.media[key]) {
          await deleteCloudinaryFile(task[key], folder);
        }
        task.media[key] = await uploadBufferToCloudinary(
          req.files[key][0].buffer,
          folder,
          key === "video" ? "video" : "auto"
        );
      }
    }

    await task.save();

    return res.status(200).json({ message: "Task updated successfully", task });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }
};

const deleteTask = async (req, res) => {
  try {
    const task = await taskModel.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    if (task.status !== "cancelled") {
      return res
        .status(400)
        .json({ error: "Task must be cancelled to delete" });
    }

    if (task.client.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ error: "Unauthorized to delete this task" });
    }

    task.deletedAt = new Date();
    await task.save();

    const mediaTypes = {
      image: "images",
      document: "documents",
      video: "videos",
    };
    for (const [key, folder] of Object.entries(mediaTypes)) {
      if (task[key]) {
        const publicId = task[key].split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(`airRand/${folder}/${publicId}`);
      }
    }

    return res
      .status(200)
      .json({
        message:
          "Task marked for deletion, refund will be processed in 48 hours",
      });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }
};

const assignTasker = async (req, res) => {
  try {
    const { taskId, taskerId } = req.params;
    const task = await taskModel.findById(taskId);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    if (req.user._id.toString() !== task.client.toString()) {
      return res.status(403).json({ error: "Unauthorized to assign tasker" });
    }

    if (!task.appliedTaskers.includes(taskerId)) {
      return res
        .status(400)
        .json({ error: "Tasker did not apply for this task" });
    }

    if (task.designatedTasker) {
      return res.status(400).json({ error: "Task already assigned" });
    }

    task.designatedTasker = taskerId;
    task.status = "in-progress";

    await task.save();

    await sendNotification(taskerId, `A new task has been assigned to you: ${task.title}`);
    return res
      .status(200)
      .json({ message: "Tasker assigned successfully", task });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }
};

const approveTask = async (req, res) => {
  try {
    const task = await taskModel
      .findById(req.params.taskId)
      .populate("client designatedTasker");

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    if (req.user._id.toString() !== task.client._id.toString()) {
      return res
        .status(403)
        .json({ error: "Unauthorized to approve this task" });
    }

    if (task.status !== "completed") {
      return res.status(400).json({ error: "Task is not completed yet" });
    }

    const taskerAmount = Number(task.pricing * 0.8);
    // const platformAmount = Number(task.pricing * 0.2);
    const tasker = task.designatedTasker;

    let taskerWallet = await walletModel.findOne({ user: tasker });

    if (!taskerWallet) {
      taskerWallet = new walletModel({
        user: tasker,
        balance: taskerAmount,
      });

      await taskerWallet.save();
    } else {
      taskerWallet.balance += taskerAmount;
      await taskerWallet.save();
    }

    task.paymentStatus = "paid";
    await task.save();


     await sendNotification(
       task.designatedTasker._id,
       "Your task has been approved!"
     );

    return res
      .status(200)
      .json({ message: "Payment released to tasker and platform" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }
};

const submitReview = async (req, res) => {
  try {
    const { taskId, message, rating } = req.body;
    const userId = req.user._id;

    if (!taskId || !message || !rating) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const task = await taskModel.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    if (task.status !== "completed") {
      return res
        .status(400)
        .json({ error: "You can only review completed tasks" });
    }

    if (
      ![task.client.toString(), task.designatedTasker.toString()].includes(
        userId.toString()
      )
    ) {
      return res.status(403).json({ error: "Unauthorized to review this task"})
    }


    const newReview = new reviewModel({
      taskId,
      user: userId,
      message,
      rating,
    })

    await newReview.save();

    return res.status(201).json({ message: "Review submitted successfully", review: newReview });
  } catch (error) {
    console.error("Error submitting review:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

module.exports = {
  createTask,
  updateTask,
  deleteTask,
  assignTasker,
  approveTask,
  submitReview
};
