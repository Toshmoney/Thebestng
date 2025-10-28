const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mailsender = require("../services/mailService");
const userModel = require("../models/User");
const walletModel = require("../models/Wallet");
const generateOtp = require("../helpers/otpHelper");
const generateReferralCode = require("../helpers/referralCode");
const referralModel = require("../models/Referral");
const crypto = require("crypto")
require("dotenv").config();

const register = async (req, res) => {
  const { role, username, email, password, referralCode } = req.body;

  try {
    if (!role || !email || !password || !username) {
      return res.status(400).json({ error: "All fields are required!" });
    }

    const existingUser = await userModel.findOne({ email });

    if (existingUser) {
      return res.status(409).json({ error: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    let newReferralCode;
    let isUnique = false;

    while (!isUnique) {
      newReferralCode = generateReferralCode();
      const existingCode = await userModel.findOne({
        referralCode: newReferralCode,
      });
      if (!existingCode) isUnique = true;
    }


    let referrerUser = null;
    if (referralCode) {
      referrerUser = await userModel.findOne({ referralCode });
    }


    const newUser = new userModel({
      role,
      username,
      email,
      password: hashedPassword,
      referralCode: newReferralCode,
      referredBy: referrerUser ? referrerUser._id : null,
    });

    const token = jwt.sign({ userId: newUser._id }, process.env.jwt_secret, {
      expiresIn: "1h",
    });

    newUser.token = token;

    const userWallet = new walletModel({
      user: newUser._id,
      balance: 0,
    });

    await newUser.save();
    await userWallet.save();

    if(referrerUser) {
      await referralModel.create({
        user: newUser._id,
        referrer: referrerUser._id,
        referralCode: newReferralCode
      });
    }

    const emailBody = `Dear ${username}, you've successfully signed up`;
    await mailsender(email, "SignUp successful", emailBody);

    res.status(201).json({ message: "Registered successfully", token });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ error: "An error occurred during registration" });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "All fields are required!" });
  }

  try {
    const existingUser = await userModel.findOne({ email });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found." });
    }

    const passMatch = await bcrypt.compare(password, existingUser.password);

    if (!passMatch) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const token = jwt.sign(
      { userId: existingUser._id },
      process.env.jwt_secret,
      {
        expiresIn: "1h",
      }
    );

    return res.status(200).json({ token });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "An error occurred during login" });
  }
};

const forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const { value: otp, expiry: otpExpires } = generateOtp();

    const user = await userModel.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const hashedOtp = await bcrypt.hash(otp, 10);

    user.resetToken = hashedOtp;
    user.resetExpires = otpExpires;

    await user.save();

    const emailBody = `Your OTP for password reset is: ${otp}. It will expire in the next 10mins`;
    await mailsender(email, "Password Reset OTP", emailBody);

    res.status(200).json({ message: "Password reset email sent successfully" });
  } catch (error) {
    console.error("Error in forgotPassword:", error);
    return res.status(500).json({
      error: "An error occurred while sending the password reset email.",
    });
  }
};

const verifyOtp = async (req, res) => {
  const { otp } = req.body;
  try {
    const user = await userModel.findOne({ resetToken: { $exists: true } });

    if (!user || user.resetExpires < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired OTP!" });
    }

    const isMatch = await bcrypt.compare(otp, user.resetToken);

    if (!isMatch) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    user.isOtpVerified = true;
    user.resetToken = undefined;
    user.resetExpires = undefined;

    await user.save();

    return res.status(200).json({ message: "OTP verified successfully!" });
  } catch (error) {
    console.error("Error verifyig OTP:", error);
    res.status(500).json({ error: "An error occurred while verifying OTP" });
  }
};

const resetPassword = async (req, res) => {
  const { password } = req.body;
  try {
    const user = await userModel.findOne({ isOtpVerified: true });

    if (!user) {
      return res
        .status(400)
        .json({ error: "User not verified for password reset!" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user.password = hashedPassword;
    user.isOtpVerified = false;

    await user.save();

    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    res
      .status(500)
      .json({ error: "An error occurred while changing the password" });
  }
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user._id;

  try {
    const user = await userModel.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    await user.save();

    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    res
      .status(500)
      .json({ error: "An error occurred while chnaging the password" });
  }
};

const switchRole = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await userModel.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "Admins cannot switch roles." });
    }

    if (user.role === "admin") {
      return res.status(403).json({ error: "Admins cannot switch roles." });
    }

    user.role = user.role === "tasker" ? "client" : "tasker";
    await user.save();

    return res.status(200).json({
      message: `Role switched to ${user.role} successfully`,
      user: { id: user._id, username: user.username, role: user.role },
    });
  } catch (error) {
    console.error("Error switching roles:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
module.exports = {
  register,
  login,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword,
  switchRole
};
