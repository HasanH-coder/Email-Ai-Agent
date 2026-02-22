function getAccounts(req, res) {
  res.status(200).json({
    accounts: [
      { id: '1', provider: 'gmail', email: 'account@gmail.com', connected: false },
      { id: '2', provider: 'outlook', email: 'test@outlook.com', connected: false },
    ],
  })
}

module.exports = {
  getAccounts,
}

