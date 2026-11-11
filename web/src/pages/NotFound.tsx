import { Link } from "react-router-dom";
import { EmptyState, buttonClass } from "../components/ui";

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      className="flex-1"
      action={
        <Link to="/" className={buttonClass("secondary", "sm")}>
          Go to the camera wall
        </Link>
      }
    >
      The link may be old, or the page has moved.
    </EmptyState>
  );
}
