const express = require('express')

const { getAccounts, createAccount } = require('../controllers/accountController')
const authMiddleware = require('../middleware/authMiddleware')

const router = express.Router()

router.use(authMiddleware)
router.get('/', getAccounts)
router.post('/', createAccount)

module.exports = router
