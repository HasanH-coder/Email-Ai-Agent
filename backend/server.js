const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')

const testRoutes = require('./routes/testRoutes')
const accountRoutes = require('./routes/accountRoutes')
const errorHandler = require('./middleware/errorHandler')

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

app.use('/api/test', testRoutes)
app.use('/api/accounts', accountRoutes)

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
