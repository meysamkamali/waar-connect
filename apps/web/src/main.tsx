import { LocationProvider, Route, Router } from 'preact-iso';
import { render } from 'preact';
import { GuestPage } from './guest/GuestPage.tsx';
import './styles.css';

function Home() {
  return (
    <div class="screen center">
      <div class="card">
        <img class="logo" src="/app/logo.svg" alt="waar Connect" />
        <h1>waar Connect</h1>
        <p class="muted">Guests arrive through the link the producer sent them. Producer and engineer screens follow in the next milestone.</p>
        <p class="muted small">
          <a href="https://github.com/meysamkamali/waar-connect" rel="noopener" target="_blank">
            Source code
          </a>
        </p>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div class="screen center">
      <div class="card">
        <h1>404</h1>
      </div>
    </div>
  );
}

function App() {
  return (
    <LocationProvider>
      <Router>
        <Route path="/app/g/:token" component={GuestPage} />
        <Route path="/app/" component={Home} />
        <Route path="/app" component={Home} />
        <Route default component={NotFound} />
      </Router>
    </LocationProvider>
  );
}

render(<App />, document.getElementById('app')!);
