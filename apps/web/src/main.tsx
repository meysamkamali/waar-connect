import { LocationProvider, Route, Router } from 'preact-iso';
import { render } from 'preact';
import { GuestPage } from './guest/GuestPage.tsx';
import { OutPage } from './out/OutPage.tsx';
import { ReturnPage } from './return/ReturnPage.tsx';
import { StaffApp } from './staff/StaffApp.tsx';
import './styles.css';

const Producer = (props: { id?: string }) => <StaffApp id={props.id} page="pcrs" />;
const Engineer = (props: { id?: string }) => <StaffApp id={props.id} page="engineer" />;
const Contacts = () => <StaffApp page="contacts" />;
const Admin = () => <StaffApp page="admin" />;
const Station = () => <StaffApp page="station" />;

function Home() {
  return (
    <div class="screen center">
      <div class="card">
        <img class="logo" src="/app/logo.svg" alt="waar Connect" />
        <h1>waar Connect</h1>
        <p class="muted">Guests arrive through the link the producer sent them.</p>
        <p class="row">
          <a class="btn" href="/app/producer">
            Producer
          </a>
          <a class="btn secondary" href="/app/engineer">
            Engineer
          </a>
          <a class="btn secondary" href="/app/contacts">
            Contacts
          </a>
          <a class="btn secondary" href="/app/admin">
            Admin
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
        <Route path="/app/contacts" component={Contacts} />
        <Route path="/app/admin/station" component={Station} />
        <Route path="/app/admin" component={Admin} />
        <Route path="/app/return/:id" component={ReturnPage} />
        <Route path="/app/out/:id/:slot" component={OutPage} />
        <Route path="/app/" component={Home} />
        <Route path="/app" component={Home} />
        <Route default component={NotFound} />
      </Router>
    </LocationProvider>
  );
}

render(<App />, document.getElementById('app')!);
