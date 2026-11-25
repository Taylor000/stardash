import { redirect } from "next/navigation"
import { requireAuth } from "@/lib/auth"
import { db } from "@/lib/db"
export default async function RepoPage({params}:{params:Promise<{owner:string;repo:string}>}){
 const user=await requireAuth(),{owner,repo}=await params
 const row=db.prepare("select r.github_repo_id from repos r join user_starred_repos u on u.repo_id=r.id where u.user_id=? and r.owner=? and r.name=?").get(user.id,owner,repo) as {github_repo_id:number}|undefined
 redirect(row?"/dashboard?repo="+row.github_repo_id:"/dashboard")
}
