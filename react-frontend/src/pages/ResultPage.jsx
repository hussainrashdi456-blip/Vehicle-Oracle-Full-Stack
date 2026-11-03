import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Activity } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { formatSpaced } from '../lib/format'
import PageTransition from '../components/layout/PageTransition'

export default function ResultPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state

  const [marketData, setMarketData] = useState(null)
  const [loadingMarket, setLoadingMarket] = useState(true)

  useEffect(() => {
    if (state && state.input) {
      // Market Comparison API Call
      fetch(`http://localhost:5000/api/market-comparison?brand=${state.input.Brand}&model=${state.input.Model}&year=${state.input.Year}`)
        .then(res => res.json())
        .then(d => { 
          setMarketData(d); 
          setLoadingMarket(false); 
        })
        .catch(() => setLoadingMarket(false));
    }
  }, [state]);

  if (!state) {
    navigate('/predict')
    return null
  }

  const { input, label, result } = state
  const price = result.price
  const priceInLacs = (price / 100000).toFixed(1)
  
  const factors = result.explanation?.top_factors || []
  const chartData = factors.map(f => ({
    name: f.feature.replace('_Cleaned', '').replace('Car_Age', 'Age'),
    value: Math.abs(f.importance),
    raw: f.importance
  }))

  return (
    <PageTransition>
      <div className="mx-auto max-w-4xl px-4 py-12 sm:py-20">
        
        <button onClick={() => navigate('/predict')} className="mb-8 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-sky-600 transition-colors">
          <ArrowLeft size={16} /> Value another car
        </button>

        <div className="grid gap-8 md:grid-cols-2">
          
          {/* Left Side: Price Card & Market Comparison */}
          <div className="space-y-4">
            <motion.div 
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-3xl bg-gradient-to-br from-sky-600 to-sky-900 p-8 text-white shadow-xl shadow-sky-900/20"
            >
              <p className="text-sm font-semibold text-sky-100 mb-2">AI Estimated Value</p>
              <h1 className="text-4xl font-extrabold tracking-tight mb-1">PKR {price.toLocaleString()}</h1>
              <p className="text-lg font-medium text-sky-200 mb-8">≈ {priceInLacs} Lacs</p>
              
              <div className="space-y-3 border-t border-sky-700/50 pt-6">
                <div className="flex justify-between text-sm">
                  <span className="text-sky-200">Vehicle</span>
                  <span className="font-semibold text-right">{label}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-sky-200">Mileage</span>
                  <span className="font-semibold">{formatSpaced(input.Mileage_Cleaned)} km</span>
                </div>
              </div>
            </motion.div>

            {/* Market Comparison Box */}
            {!loadingMarket && marketData && marketData.listings_found > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white p-5 rounded-2xl shadow-card border border-slate-100">
                <div className="flex items-center gap-2 mb-3">
                  <Activity size={18} className="text-emerald-500" />
                  <h3 className="font-bold text-slate-800">Market Reality Check</h3>
                </div>
                <p className="text-xs text-slate-500 mb-4">
                  Based on <b>{marketData.listings_found}</b> similar cars in our database.
                </p>
                
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Lowest in Market</span>
                    <span className="font-semibold text-slate-700">PKR {marketData.min_price.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden relative">
                    <div 
                      className="absolute top-0 bottom-0 w-1.5 bg-sky-500 z-10 rounded-full shadow-sm"
                      style={{ 
                        left: `${Math.min(100, Math.max(0, ((price - marketData.min_price) / (marketData.max_price - marketData.min_price)) * 100))}%` 
                      }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Highest in Market</span>
                    <span className="font-semibold text-slate-700">PKR {marketData.max_price.toLocaleString()}</span>
                  </div>
                </div>
                <p className="text-[11px] text-center text-sky-600 mt-4 font-semibold bg-sky-50 py-2 rounded-lg">
                  Your AI Estimate is {price < marketData.average_price ? 'below' : 'above'} the market average.
                </p>
              </motion.div>
            )}
          </div>

          {/* Right Side: Dynamic SHAP Chart */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="rounded-3xl bg-white p-8 shadow-card border border-slate-100 flex flex-col"
          >
            <h3 className="text-lg font-bold text-slate-800 mb-1">Why this price?</h3>
            <p className="text-sm text-slate-500 mb-6">AI analysis of this specific car's features</p>
            
            <div className="flex-1 w-full min-h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={90} tick={{fill: '#475569', fontSize: 12, fontWeight: 600}} axisLine={false} tickLine={false} />
                  <Tooltip 
                    cursor={{fill: '#f8fafc'}}
                    formatter={(val, name, props) => [`PKR ${Math.abs(props.payload.raw).toLocaleString()}`, props.payload.raw > 0 ? 'Increases Price' : 'Decreases Price']} 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={24}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.raw > 0 ? '#0ea5e9' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500 bg-slate-50 p-3 rounded-lg">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-[#0ea5e9]"></div> Increases Price</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-[#f43f5e]"></div> Decreases Price</div>
            </div>
          </motion.div>
          
        </div>
      </div>
    </PageTransition>
  )
}