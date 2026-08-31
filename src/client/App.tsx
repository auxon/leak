import { useEffect, useState } from "react";
import { AppPage } from "./pages/AppPage";
import { LandingPage } from "./pages/LandingPage";
import { fetchMe, type Me } from "./lib/api";
import { appPath } from "./lib/router";

export function App() {
  const [path, setPath] = useState(appPath);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    const onPop = () => setPath(appPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    void fetchMe().then(setMe);
  }, [path]);

  if (path.startsWith("/app")) {
    return <AppPage me={me} onMe={setMe} />;
  }
  return <LandingPage me={me} />;
}
