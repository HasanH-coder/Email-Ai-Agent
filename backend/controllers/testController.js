function getTestMessage(req, res) {
  res.status(200).json({ message: 'Backend working' })
}

module.exports = {
  getTestMessage,
}

