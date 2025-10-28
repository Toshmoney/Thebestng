const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["client", "tasker", "admin"], required: true },
    field: { type: String },
    skillset: { type: [String] },
    location: { type: String },
    description: { type: String },
    resetToken: String,
    resetExpires: Date,
    isOtpVerified: { type: Boolean, default: false },
    referralCode: { type: String, unique: true },
    referredBy: { type: Schema.Types.ObjectId, ref: "User" },
    isEmailVerified: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

const userModel = model("User", userSchema);

module.exports = userModel;
