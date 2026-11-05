// All network access lives here.
const API_URL = 'http://localhost:5000';
const USE_MOCK = false;

// Helper to get token from localStorage
const getToken = () => localStorage.getItem('token')

// Helper for standard headers
const getHeaders = (isJson = true) => {
  const headers = {}
  if (isJson) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

// 1. Price Prediction API
export async function predictPrice(payload) {
  if (USE_MOCK) return mockPredict(payload)
  const res = await fetch(`${API_URL}/api/predict`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || err.detail || `Prediction failed (${res.status})`)
  }
  return res.json()
}

// 2. Stats API
export const getStats = async () => {
  const res = await fetch(`${API_URL}/api/stats`)
  if (!res.ok) throw new Error('Stats fetch failed')
  return res.json()
}

// 3. Car Options API
export const getCarOptions = async () => {
  const res = await fetch(`${API_URL}/api/car-options`)
  if (!res.ok) throw new Error('Options fetch failed')
  return res.json()
}

// 4. Car Details API
export const getCarDetails = async (brand, model) => {
  const res = await fetch(`${API_URL}/api/car-details?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}`)
  if (!res.ok) throw new Error('Details fetch failed')
  return res.json()
}

// 5. Market Comparison API
export const getMarketComparison = async (brand, model, year) => {
  const res = await fetch(`${API_URL}/api/market-comparison?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}&year=${year}`)
  if (!res.ok) throw new Error('Market comparison failed')
  return res.json()
}

// 6. Trends API
export const getTrends = async () => {
  const res = await fetch(`${API_URL}/api/trends`)
  if (!res.ok) throw new Error('Trends fetch failed')
  return res.json()
}

// 7. Detect Damage API (Image Upload)
export const detectDamage = async (file) => {
  const formData = new FormData()
  formData.append('image', file)
  const res = await fetch(`${API_URL}/api/detect-damage`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getToken()}` },
    body: formData,
  })
  if (!res.ok) throw new Error('Damage detection failed')
  return res.json()
}

// 8. Auth APIs
export const loginUser = async (credentials) => {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Login failed')
  return data
}

export const signupUser = async (credentials) => {
  const res = await fetch(`${API_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Signup failed')
  return data
}

// 9. History & Admin APIs
export const getHistory = async () => {
  const res = await fetch(`${API_URL}/api/history`, { headers: getHeaders(false) })
  if (!res.ok) throw new Error('History fetch failed')
  return res.json()
}

export const getAdminStats = async () => {
  const res = await fetch(`${API_URL}/api/admin/stats`, { headers: getHeaders(false) })
  if (!res.ok) throw new Error('Admin stats fetch failed')
  return res.json()
}

// Mock function (agar backend na chale toh)
async function mockPredict(p) {
  await new Promise((r) => setTimeout(r, 1100))
  const age = 2025 - p.Year
  const base = 1_000_000 + p.Engine_Cleaned * 2600
  const price = Math.max(250_000, base * Math.pow(0.93, age) - p.Mileage_Cleaned * 6 + p.Feature_Count * 18_000)
  return {
    mock: true,
    price,
    explanation: {
      top_factors: [
        { feature: 'Model', importance: 0.34, direction: 'up' },
        { feature: 'Car_Age', importance: 0.27, direction: 'down' },
      ],
    },
  }
}