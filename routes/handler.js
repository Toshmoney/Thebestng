const express = require('express');
const { register, login, forgotPassword, verifyOtp, changePassword, resetPassword, switchRole } = require('../controllers/authController');
const { isLoggedIn } = require('../middleware/authenticate');
const { verifyTransaction, withdrawalRequest, supportedBanks, resolveBanks, fundWallet } = require('../controllers/paymentController');
const app = express();
app.use(express.json());

const router = express.Router();

router.route('/register').post(register);
router.route("/verify-email/:token").get(verifyEmail);
router.route('/login').post(login);
router.route('/forgotPassword').post(forgotPassword);
router.route('/verify-otp').post(verifyOtp);
router.route('/reset-password').post(resetPassword);
router.route('/change-password').post(isLoggedIn, changePassword);

router.route('/switch-role').patch(isLoggedIn, switchRole);

router.route('/verify-payment').post(isLoggedIn, verifyTransaction);
router.route('/withdraw').post(isLoggedIn, withdrawalRequest);
router.route('/supported-banks').get(supportedBanks);
router.route('/resolve-banks').post(resolveBanks);
router.route('/fund-wallet').post(isLoggedIn, fundWallet);


module.exports = router;