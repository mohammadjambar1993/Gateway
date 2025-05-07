import React from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import Layout from "../components/layout/Layout";

import HomePage from "../pages/Home";


// import RedeemGuide from "../modals/RedeemGuide";
import styled from "styled-components/macro";

import {
  ROUTE_INDEX,
  // ROUTE_DASHBOARD,
  ROUTE_PODS,
  ROUTE_SETTINGS,
  ROUTE_STATS,
} from "./routes";

const Container = styled.div`
  display: flex;
  height: 100%;
  justify-content: center;
  align-items: center;
  flex-flow: column;
`;

export default function RouterComponent() {
  if (window.location.pathname.includes("serviceworker")) {
    return <></>;
  } else {
    return (
      <Router>
        <Layout>
          <Container>
            <Routes>
              <Route
                exact
                path={ROUTE_INDEX}
                element={<HomePage />}
              />
              <Route
                exact
                path={ROUTE_PODS}
                element={<></>}
              />
              <Route exact path={ROUTE_SETTINGS} element={<></>} />
              <Route
                exact
                path={ROUTE_STATS}
                element={<></>}
              />
            </Routes>
          </Container>
        </Layout>
      </Router>
    );
  }
};
