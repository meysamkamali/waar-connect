import { LocationProvider, Route, Router } from 'preact-iso';
import { render } from 'preact';
import { GuestPage } from './guest/GuestPage.tsx';
import { StaffApp } from './staff/StaffApp.tsx';
import './styles.css';

const Producer = (props: { id?: string }) => <StaffApp id={props.id} />;
const Engineer = (props: { id?: string }) => <StaffApp id={props.id} engineer />;

function Home() {
  return (
    <div class="screen center">
      <div class="card">
        <img class="logo" src="/app/logo.svg" alt="waar Connect" />
        <h1>waar Connect</h1>
        <p class="muted">Guests arrive through the link the producer sent them.</p>
        <p>
          <a class="btn" href="/app/producer">
            Producer
          </a>{' '}
          <a class="btn secondary" href="/app/engineer">
            Engineer
          </a>
        </p>
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
        <Route path="/app/producer/:id" component={Producer} />
        <Route path="/app/producer" component={Producer} />
        <Route path="/app/engineer/:id" component={Engineer} />
        <Route path="/app/engineer" component={Engineer} />
        <Route path="/app/" component={Home} />
        <Route path="/app" component={Home} />
        <Route default component={NotFound} />
      </Router>
    </LocationProvider>
  );
}

render(<App />, document.getElementById('app')!);
