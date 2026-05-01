import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Modal from "../ui/Modal.jsx";

export default function SettingsModalShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const bg = location.state?.backgroundLocation ?? {
    pathname: "/",
    search: "",
    hash: "",
    state: null,
    key: "settings-bg",
  };

  const close = () => {
    if (location.state?.backgroundLocation) {
      navigate(-1);
    } else {
      navigate(`${bg.pathname}${bg.search}${bg.hash}`, { replace: true });
    }
  };

  return (
    <Modal onClose={close} labelledBy="settings-modal-title">
      <Outlet context={{ onClose: close }} />
    </Modal>
  );
}
