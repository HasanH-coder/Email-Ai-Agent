const express = require('express')

const { getAccounts } = require('../controllers/accountController')

const router = express.Router()

router.get('/', getAccounts)

module.exports = router

