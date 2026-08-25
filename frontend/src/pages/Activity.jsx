import { useEffect, useState } from "react";
import ActivityFeed from "../components/ActivityFeed";
import LoadingState, { ErrorState } from "../components/LoadingState";
import { getRecentActivity, getRecoveryCases } from "../services/api";

function Activity() {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadActivity = async () => {
      try {
        const [activityData, casesData] = await Promise.all([
          getRecentActivity(),
          getRecoveryCases(),
        ]);

        const lookup = {};
        (casesData || []).forEach((item) => {
          lookup[item.case_number] = item.id;
        });

        setActivity(
          (activityData || []).map((item) => ({
            ...item,
            case_id: lookup[item.case_number],
          }))
        );
      } catch (err) {
        console.error(err);
        setError("Unable to connect to RecoverAI API.");
      } finally {
        setLoading(false);
      }
    };

    loadActivity();
  }, []);

  if (loading) return <LoadingState message="Loading activity..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="page-enter space-y-6">
      <div>
        <p className="eyebrow">Operations Feed</p>
        <h2 className="page-title">Activity</h2>
        <p className="mt-2 text-sm text-ink-mute">
          Latest recovery case updates from the pipeline
        </p>
      </div>

      <section className="panel p-6">
        <ActivityFeed items={activity} />
      </section>
    </div>
  );
}

export default Activity;
