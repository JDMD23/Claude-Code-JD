import { Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import DealPipeline from './pages/DealPipeline';
import Prospects from './pages/Prospects';
import MasterList from './pages/MasterList';
import LeaseIntelligence from './pages/LeaseIntelligence';
import Commissions from './pages/Commissions';

function App() {
  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/pipeline" element={<DealPipeline />} />
        <Route path="/prospects" element={<Prospects />} />
        <Route path="/master-list" element={<MasterList />} />
        <Route path="/lease-intelligence" element={<LeaseIntelligence />} />
        <Route path="/commissions" element={<Commissions />} />
      </Routes>
    </MainLayout>
  );
}

export default App;
