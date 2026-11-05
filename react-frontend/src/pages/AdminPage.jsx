import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Users, Car, TrendingUp, ShieldAlert } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import PageTransition from '../components/layout/PageTransition'
import { useAuth } from '../context/AuthContext'
import { getAdminStats } from '../services/api'

export default function AdminPage() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    // Agar user login nahi hai ya admin nahi hai, toh rok dein
    if (!user || user.role !== 'admin') {
      setLoading(false)
      return
    }

    // Backend se data fetch karein
    getAdminStats()
      .then(d => {
        setData(d)
        setLoading(false)
      })
      .catch(err => {
        console.error("Admin data fetch error:", err)
        setError("Could not load admin data. Please log out and log in again.")
        setLoading(false)
      })
  }, [user])

  // Agar user admin nahi hai
  if (!user || user.role !== 'admin') {
    return (
      <PageTransition>
        <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
          <ShieldAlert size={64} className="text-rose-500 mb-4" />
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Access Denied</h1>
          <p className="text-slate-500">You do not have permission to view this page.</p>
        </div>
      </PageTransition>
    )
  }

  // Loading state
  if (loading) return <div className="text-center py-20 text-slate-500">Loading Dashboard...</div>

  // Agar data fetch fail ho jaye
  if (error || !data) {
    return (
      <PageTransition>
        <div className="text-center py-20">
          <p className="text-rose-500 text-lg mb-4">{error || "Failed to load admin data."}</p>
        </div>
      </PageTransition>
    )
  }

  // Agar sab kuch theek hai, toh Dashboard dikhayein
  return (
    <PageTransition>
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-extrabold text-slate-800">Admin Dashboard</h1>
          <p className="text-slate-500 mt-2">Welcome back, Admin. Here is the system overview.</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} transition={{delay:0.1}} className="bg-white p-6 rounded-2xl shadow-card border border-slate-100 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
              <Users size={28} />
            </div>
            <div>
              <p className="text-slate-500 text-sm font-semibold">Total Users</p>
              <p className="text-3xl font-extrabold text-slate-800">{data.totalUsers || 0}</p>
            </div>
          </motion.div>

          <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} transition={{delay:0.2}} className="bg-white p-6 rounded-2xl shadow-card border border-slate-100 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center">
              <Car size={28} />
            </div>
            <div>
              <p className="text-slate-500 text-sm font-semibold">Listings</p>
              <p className="text-3xl font-extrabold text-slate-800">{data.totalListings || 0}</p>
            </div>
          </motion.div>

          <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} transition={{delay:0.3}} className="bg-white p-6 rounded-2xl shadow-card border border-slate-100 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <TrendingUp size={28} />
            </div>
            <div>
              <p className="text-slate-500 text-sm font-semibold">Predictions</p>
              <p className="text-3xl font-extrabold text-slate-800">{data.totalPredictions || 0}</p>
            </div>
          </motion.div>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Chart: Top Brands */}
          <div className="bg-white p-6 rounded-2xl shadow-card border border-slate-100">
            <h2 className="text-lg font-bold text-slate-800 mb-6">Top Searched Brands</h2>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.brandStats || []} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12, fontWeight: 600}} width={80} />
                  <Tooltip cursor={{fill: '#f8fafc'}} />
                  <Bar dataKey="count" fill="#0ea5e9" radius={[0, 4, 4, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Users Table */}
          <div className="bg-white p-6 rounded-2xl shadow-card border border-slate-100">
            <h2 className="text-lg font-bold text-slate-800 mb-6">Recent Signups</h2>
            <div className="space-y-4">
              {data.recentUsers?.map((u, i) => (
                <div key={i} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0">
                  <div>
                    <p className="font-semibold text-slate-800">{u.name}</p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </div>
                  <span className="text-xs font-semibold text-slate-400">{new Date(u.date).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </PageTransition>
  )
}