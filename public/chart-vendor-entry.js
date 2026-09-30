// ABOUTME: Bundles only the Chart.js controllers the Usage page draws.
// ABOUTME: Usage dashboard charts must not fetch a remote CDN script.
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";

Chart.register(
  BarController,
  DoughnutController,
  BarElement,
  ArcElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
);

globalThis.Chart = Chart;
