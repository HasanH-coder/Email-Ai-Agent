const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')

dotenv.config()

const testRoutes = require('./routes/testRoutes')
const accountRoutes = require('./routes/accountRoutes')
const dbTestRoutes = require('./routes/dbTestRoutes')
const authRoutes = require('./routes/authRoutes')
const connectRoutes = require('./routes/connectRoutes')
const emailRoutes = require('./routes/emailRoutes')
const logoRoutes = require('./routes/logoRoutes')
const errorHandler = require('./middleware/errorHandler')

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

app.use('/api/test', testRoutes)
app.use('/api/accounts', accountRoutes)
app.use('/api/db-test', dbTestRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/connect', connectRoutes)
app.use('/api/emails', emailRoutes)
app.use('/api', logoRoutes)

app.use(errorHandler)

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set a different PORT in your .env file.`)
    process.exit(1)
  }
  console.error('Server failed to start:', error.message)
  process.exit(1)
})
